# DAKA - Entity-Relationship Model

## Entity Relationship Diagram - Core Data Model

```mermaid
erDiagram

    USERS {
        INT id PK
        VARCHAR username
        VARCHAR email
        VARCHAR pass_hash
        VARCHAR avatar
        VARCHAR user_location
        TIMESTAMP created_at
        TIMESTAMP updated_at
    }

    CATEGORIES {
        INT id PK
        VARCHAR category_name
    }

    CONDITIONS {
        INT id PK
        VARCHAR condition_name
    }

    ITEM_STATES {
        INT id PK
        VARCHAR state_name
    }

    OFFER_STATES {
        INT id PK
        VARCHAR state_name
    }

    ITEMS {
        INT id PK
        INT user_id FK
        INT category_id FK
        INT condition_id FK
        INT state_id FK
        VARCHAR title
        TEXT item_dsc
        VARCHAR item_location
        TIMESTAMP created_at
        TIMESTAMP updated_at
    }

    OFFERS {
        INT id PK
        INT item_requested_id FK
        INT sender_id FK
        INT offered_item_id FK
        INT offer_state_id FK
        VARCHAR initial_msg
        TIMESTAMP created_at
        TIMESTAMP updated_at
    }

    USERS ||--o{ ITEMS : publishes
    CATEGORIES ||--o{ ITEMS : categorizes
    CONDITIONS ||--o{ ITEMS : condition
    ITEM_STATES ||--o{ ITEMS : state

    USERS ||--o{ OFFERS : creates
    ITEMS ||--o{ OFFERS : requested_item
    ITEMS ||--o| OFFERS : offered_item
    OFFER_STATES ||--o{ OFFERS : status
```
<br>
<br>

## Entity Relationship Diagram - Support Data Model

```mermaid
erDiagram

    IMAGES {
        INT id PK
        INT item_id FK
        VARCHAR image_path
        BOOLEAN is_primary
    }

    MESSAGES {
        INT id PK
        INT offer_id FK
        INT msg_sender FK
        VARCHAR msg
        TIMESTAMP created_at
    }

    REPORTS {
        INT id PK
        INT reporter_id FK
        INT reported_item_id FK
        INT reported_user_id FK
        VARCHAR reason
        TIMESTAMP created_at
    }

    FAVORITES {
        INT user_id PK,FK
        INT item_id PK,FK
    }

    USERS {
        INT id PK
        VARCHAR username
        VARCHAR email
        VARCHAR pass_hash
        VARCHAR avatar
        VARCHAR user_location
        TIMESTAMP created_at
        TIMESTAMP updated_at
    }

    ITEMS {
        INT id PK
        INT user_id FK
        INT category_id FK
        INT condition_id FK
        INT state_id FK
        VARCHAR title
        TEXT item_dsc
        VARCHAR item_location
        TIMESTAMP created_at
        TIMESTAMP updated_at
    }

    OFFERS {
        INT id PK
        INT item_requested_id FK
        INT sender_id FK
        INT offered_item_id FK
        INT offer_state_id FK
        VARCHAR initial_msg
        TIMESTAMP created_at
        TIMESTAMP updated_at
    }

    ITEMS ||--o{ IMAGES : contains

    OFFERS ||--o{ MESSAGES : contains
    USERS ||--o{ MESSAGES : sends

    USERS ||--o{ REPORTS : reports
    USERS ||--o{ REPORTS : reported_user
    ITEMS ||--o{ REPORTS : reported_item

    USERS ||--o{ FAVORITES : saves
    ITEMS ||--o{ FAVORITES : favorited

```
