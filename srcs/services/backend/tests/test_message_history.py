"""HTTP tests for private, stable cursor pagination of negotiation messages."""
from datetime import datetime, timedelta
import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import (Category, Condition, Listing, ListingState, Message,
                        Negotiation, NegotiationState, User, UserSession)
from app.security import hash_session_token, utcnow


class MessageHistoryTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite+pysqlite:///:memory:',
            connect_args={'check_same_thread': False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine, expire_on_commit=False)()
        self.users = [User(user_name=name, email=f'{name}@example.com')
                      for name in ('owner', 'interested', 'outsider')]
        category, condition = Category(category_name='Books'), Condition(condition_name='Good')
        available = ListingState(state_name='Available')
        self.states = {name: NegotiationState(state_name=name)
                       for name in ('Open', 'Agreed', 'Completed', 'Cancelled', 'Unavailable')}
        self.db.add_all([*self.users, category, condition, available, *self.states.values()])
        self.db.flush()
        listing = Listing(user_id=self.users[0].id, title='Book', category_id=category.id,
                          condition_id=condition.id, state_id=available.id)
        self.db.add(listing)
        self.db.flush()
        self.room = Negotiation(listing_id=listing.id, interested_user_id=self.users[1].id,
                                negotiation_state_id=self.states['Open'].id)
        self.other = Negotiation(listing_id=listing.id, interested_user_id=self.users[2].id,
                                 negotiation_state_id=self.states['Open'].id)
        self.db.add_all([self.room, self.other])
        self.db.flush()
        self.ids = []
        for i in range(7):
            message = Message(negotiation_id=self.room.id, msg_sender=self.users[i % 2].id,
                              msg=f'Message {i}', created_at=datetime(2026, 10, 28, 14, 30))
            self.db.add(message)
            self.db.flush()
            self.ids.append(message.id)
            self.db.add(Message(negotiation_id=self.other.id, msg_sender=self.users[2].id, msg='Private other room'))
            self.db.flush()
        for user in self.users:
            self.db.add(UserSession(user_id=user.id, token_hash=hash_session_token(user.user_name),
                                   expires_at=utcnow() + timedelta(hours=1)))
        self.db.commit()
        self.previous_override = app.dependency_overrides.get(get_db)
        app.dependency_overrides[get_db] = lambda: self.db
        self.client = TestClient(app)
        self.client.cookies.set('daka_session', 'interested')

    def tearDown(self):
        if self.previous_override is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = self.previous_override
        self.client.close()
        self.db.close()
        self.engine.dispose()

    def get(self, room=None, **params):
        return self.client.get(f'/negotiations/{self.room.id if room is None else room}/messages', params=params)

    def test_both_participants_receive_public_data_and_default_limit(self):
        for name in ('owner', 'interested'):
            self.client.cookies.set('daka_session', name)
            response = self.get()
            self.assertEqual(response.status_code, 200)
            page = response.json()
            self.assertEqual(page['limit'], 50)
            self.assertFalse(page['has_more'])
            self.assertIsNone(page['next_before_id'])
            self.assertEqual([m['id'] for m in page['items']], self.ids)
            self.assertEqual(set(page['items'][0]['sender']), {'id', 'user_name', 'avatar'})
            self.assertEqual(page['items'][0]['created_at'], '2026-10-28T14:30:00Z')
            self.assertEqual(page['items'][0]['content'], 'Message 0')

    def test_access_control(self):
        self.client.cookies.clear()
        self.assertEqual(self.get().status_code, 401)
        self.client.cookies.set('daka_session', 'outsider')
        self.assertEqual(self.get().status_code, 403)
        self.assertEqual(self.get(room=999999).status_code, 404)

    def test_invalid_limits_and_cursors(self):
        for limit in (0, -1, 101, 'bad', '1.5'):
            self.assertEqual(self.get(limit=limit).status_code, 422)
        for cursor in (0, -1, 'bad', '1.5', 2147483648):
            self.assertEqual(self.get(before_id=cursor).status_code, 422)
        self.assertEqual(self.get(room=0).status_code, 422)
        self.assertEqual(self.get(limit=100).status_code, 200)

    def test_cursor_pages_are_chronological_and_isolated(self):
        cursor, pages = None, []
        for expected, more in ((self.ids[-3:], True), (self.ids[1:4], True), (self.ids[:1], False)):
            params = {'limit': 3}
            if cursor is not None:
                params['before_id'] = cursor
            page = self.get(**params).json()
            self.assertEqual([m['id'] for m in page['items']], expected)
            self.assertTrue(all(m['negotiation_id'] == self.room.id for m in page['items']))
            self.assertEqual(page['has_more'], more)
            self.assertEqual(page['next_before_id'], expected[0] if more else None)
            cursor = page['next_before_id']
            pages.append(expected)
        self.assertEqual(sorted(sum(pages, [])), self.ids)

    def test_new_messages_do_not_shift_older_page(self):
        cursor = self.get(limit=3).json()['next_before_id']
        self.db.add(Message(negotiation_id=self.room.id, msg_sender=self.users[0].id, msg='New'))
        self.db.commit()
        page = self.get(limit=3, before_id=cursor).json()
        self.assertEqual([m['id'] for m in page['items']], self.ids[1:4])

    def test_empty_page_exact_limit_and_arbitrary_cursor(self):
        page = self.get(before_id=self.ids[0]).json()
        self.assertEqual(page['items'], [])
        self.assertFalse(page['has_more'])
        self.assertIsNone(page['next_before_id'])
        page = self.get(limit=7).json()
        self.assertFalse(page['has_more'])
        self.assertIsNone(page['next_before_id'])
        # Cursor need not belong to this room or identify an existing message.
        page = self.get(before_id=self.ids[2] + 1).json()
        self.assertEqual([m['id'] for m in page['items']], self.ids[:3])
        self.db.query(Message).filter_by(negotiation_id=self.room.id).delete()
        self.db.commit()
        self.assertEqual(self.get().json()['items'], [])

    def test_history_remains_available_in_all_terminal_states_and_after_sender_deletion(self):
        self.users[0].deleted_at = utcnow()
        for name in ('Agreed', 'Completed', 'Cancelled', 'Unavailable'):
            self.room.negotiation_state_id = self.states[name].id
            self.db.commit()
            response = self.get()
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(response.json()['items']), 7)


if __name__ == '__main__':
    unittest.main()
