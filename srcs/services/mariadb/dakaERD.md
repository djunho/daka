# DAKA - Entity-Relationship Model

## Entity Relationship Diagram - Core Data Model

```mermaid
erDiagram

    USERS {
        INT id PK
        VARCHAR user_name
        VARCHAR email
        VARCHAR pass_hash
        VARCHAR	google_sub
        VARCHAR user_role
        VARCHAR avatar
        VARCHAR user_location
        TIMESTAMP created_at
        TIMESTAMP updated_at
        DATETIME last_seen
        DATETIME deleted_at
    }

    FRIENDSHIPS {
        INT user_id PK,FK
        INT friend_id PK,FK
        ENUM status "accepted/removed"
        TIMESTAMP created_at
    }

    CATEGORIES {
        INT id PK
        VARCHAR category_name
    }

    CONDITIONS {
        INT id PK
        VARCHAR condition_name
    }

    LISTINGS_STATES {
        INT id PK
        VARCHAR state_name
    }

    NEGOTIATION_STATES {
        INT id PK
        VARCHAR state_name
    }

    PROPOSAL_STATES {
        INT id PK
        VARCHAR state_name
    }

    LISTINGS {
        INT id PK
        INT user_id FK
        INT category_id FK
        INT condition_id FK
        INT state_id FK
        VARCHAR title
        TEXT listing_dsc
        VARCHAR listing_location
		TEXT wish
        TIMESTAMP created_at
        TIMESTAMP updated_at
    }

    NEGOTIATIONS {
        INT id PK
        INT listing_id FK
        INT interested_user_id FK
        INT negotiation_state_id FK
        INT cancelled_by_user_id FK
        DATETIME cancelled_at
        TIMESTAMP created_at
        TIMESTAMP updated_at
    }

    PROPOSALS {
        INT id PK
        INT negotiation_id FK
        INT offered_listing_id FK "nullable"
        INT offered_listing_unique_key "GENERATED: COALESCE(offered_listing_id, 0)"
        INT proposal_state_id FK
        TIMESTAMP created_at
        DATETIME responded_at
    }

    USERS ||--o{ LISTINGS : publishes
    USERS ||--o{ FRIENDSHIPS : participates
    CATEGORIES ||--o{ LISTINGS : categorizes
    CONDITIONS ||--o{ LISTINGS : condition
    LISTINGS_STATES ||--o{ LISTINGS : state

    USERS ||--o{ NEGOTIATIONS : starts
    USERS o|--o{ NEGOTIATIONS : cancels
    LISTINGS ||--o{ NEGOTIATIONS : requested
    NEGOTIATION_STATES ||--o{ NEGOTIATIONS : status

    NEGOTIATIONS ||--o{ PROPOSALS : contains
    LISTINGS o|--o{ PROPOSALS : offered_listing
    PROPOSAL_STATES ||--o{ PROPOSALS : status
```

`PROPOSALS` has a composite unique constraint on
`(negotiation_id, offered_listing_unique_key)`. The generated key normalizes a
missing `offered_listing_id` to `0`, allowing at most one proposal without an
offered listing per negotiation while also preventing the same listing from
being offered twice in that negotiation.

<br>
<br>

## Entity Relationship Diagram - Support Data Model

```mermaid
erDiagram

    IMAGES {
        INT id PK
        INT listing_id FK
        VARCHAR image_path
        BOOLEAN is_primary
    }

    MESSAGES {
        INT id PK
        INT negotiation_id FK
        INT msg_sender FK
        VARCHAR msg
        TIMESTAMP created_at
    }

    REPORTS {
        INT id PK
        INT reporter_id FK
        INT reported_listings_id FK
        INT reported_user_id FK
        VARCHAR reason
        TIMESTAMP created_at
    }

    FAVORITES {
        INT user_id PK,FK
        INT listing_id PK,FK
    }

    FRIENDSHIPS {
        INT user_id PK,FK
        INT friend_id PK,FK
        ENUM status "accepted/removed"
        TIMESTAMP created_at
    }

    USERS {
        INT id PK
        VARCHAR user_name
        VARCHAR email
        VARCHAR pass_hash
        VARCHAR	google_sub
        VARCHAR user_role
        VARCHAR avatar
        VARCHAR user_location
        TIMESTAMP created_at
        TIMESTAMP updated_at
        DATETIME last_seen
        DATETIME deleted_at
    }

    LISTINGS {
        INT id PK
        INT user_id FK
        INT category_id FK
        INT condition_id FK
        INT state_id FK
        VARCHAR title
        TEXT listing_dsc
        VARCHAR listing_location
		TEXT wish
        TIMESTAMP created_at
        TIMESTAMP updated_at
    }

    NEGOTIATIONS {
        INT id PK
        INT listing_id FK
        INT interested_user_id FK
        INT negotiation_state_id FK
        INT cancelled_by_user_id FK
        DATETIME cancelled_at
        TIMESTAMP created_at
        TIMESTAMP updated_at
    }

    LISTINGS ||--o{ IMAGES : contains

    NEGOTIATIONS ||--o{ MESSAGES : contains
    USERS ||--o{ MESSAGES : sends

    USERS ||--o{ REPORTS : reports
    USERS ||--o{ REPORTS : reported_user
    LISTINGS ||--o{ REPORTS : reported_listing

    USERS ||--o{ FAVORITES : saves
    LISTINGS ||--o{ FAVORITES : favorited
    USERS ||--o{ FRIENDSHIPS : adds
    USERS ||--o{ FRIENDSHIPS : added

```
