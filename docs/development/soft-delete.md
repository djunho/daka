# Soft Delete de Contas de Usuário

Este documento descreve a implementação de soft delete de contas de usuário no backend do Daka.

## Objetivo

Quando um usuário solicita a exclusão da própria conta, os dados não são removidos fisicamente do banco. A conta é marcada como desativada e deixa de participar das funcionalidades ativas da aplicação.

Essa abordagem preserva informações importantes para:

- moderação;
- denúncias;
- histórico de negociações;
- mensagens;
- auditoria;
- histórico dos listings.

## Endpoint

```http
DELETE /api/auth/me
```

A rota exige uma sessão válida. O usuário só pode desativar a conta associada ao próprio cookie `daka_session`.

Em caso de sucesso:

```http
204 No Content
```

Sem autenticação válida:

```http
401 Unauthorized
```

## Como funciona

A rota executa as seguintes ações:

1. Bloqueia a linha do usuário durante a transação.
2. Bloqueia os listings do usuário.
3. Marca a conta com `deleted_at`.
4. Altera os listings para o estado `Removed`.
5. Cancela os trades abertos relacionados ao usuário ou aos seus listings.
6. Remove os favoritos relacionados à conta ou aos listings.
7. Remove as sessões ativas do usuário.
8. Confirma todas as alterações em uma única transação.
9. Remove o arquivo físico do avatar depois do `commit`.
10. Limpa o cookie `daka_session`.

## Dados preservados

O soft delete não remove fisicamente:

- o registro do usuário;
- os listings;
- as imagens dos listings;
- as denúncias;
- os trades;
- as mensagens.

Os reports não são apagados para preservar o histórico de moderação. Os listings permanecem no banco com o estado `Removed`.

## Campo `deleted_at`

Foi adicionado à tabela `users`:

```sql
deleted_at DATETIME NULL
```

Os valores representam:

```text
deleted_at = NULL       conta ativa
deleted_at = data/hora  conta desativada
```

O modelo SQLAlchemy correspondente é:

```python
deleted_at: Mapped[datetime | None] = mapped_column(DateTime)
```

## Autenticação após a desativação

A dependência `get_current_user` verifica se o usuário associado à sessão possui `deleted_at IS NULL`.

Por isso, uma sessão antiga não permite acesso depois da desativação.

O login por email e senha também ignora contas desativadas. O login Google não reativa automaticamente uma conta desativada.

## Transação e concorrência

As alterações são executadas em uma transação:

```python
try:
    # alterações
    db.commit()
except IntegrityError:
    db.rollback()
```

Se ocorrer um erro de integridade, todas as alterações são revertidas e a API retorna `409 Conflict`.

As consultas de usuário e listings usam `with_for_update()` para reduzir condições de corrida com atualizações, trades ou outras operações simultâneas.

## Migration para bancos existentes

Bancos novos recebem `deleted_at` automaticamente através do `schema.sql`.

Volumes MariaDB existentes precisam executar:

```sql
ALTER TABLE users
ADD COLUMN deleted_at DATETIME NULL
AFTER updated_at;
```

Antes da migration, recomenda-se fazer backup:

```bash
mkdir -p backups

root_password=$(awk -F= '$1 == "MYSQL_ROOT_PASSWORD" {
  print substr($0, index($0, "=") + 1)
}' srcs/.env)

docker exec daka_db mariadb-dump \
  -u root \
  -p"$root_password" \
  --single-transaction \
  daka > backups/daka-before-soft-delete.sql
```

Depois, aplicar a coluna:

```bash
docker exec daka_db mariadb \
  -u root \
  -p"$root_password" \
  daka \
  -e "ALTER TABLE users
      ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL
      AFTER updated_at;"
```

Confirmar a migration:

```bash
docker exec daka_db mariadb \
  -u root \
  -p"$root_password" \
  daka \
  -e "SHOW COLUMNS FROM users LIKE 'deleted_at';"
```

## Teste completo

### 1. Iniciar os serviços

```bash
docker compose -f srcs/docker-compose.yml up -d --build
```

Verificar o estado:

```bash
docker compose -f srcs/docker-compose.yml ps
```

O backend e o banco devem aparecer como `healthy`.

### 2. Testar a API

```bash
curl -k https://localhost:8443/api/health
```

Resultado esperado:

```json
{
  "status": "ok",
  "service": "daka-api"
}
```

### 3. Criar um usuário temporário

```bash
curl -k -i \
  -X POST https://localhost:8443/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "user_name": "Soft Delete Test",
    "email": "soft-delete-test@example.com",
    "password": "SoftDelete-Test-123"
  }'
```

Resultado esperado:

```http
201 Created
```

### 4. Fazer login e guardar a sessão

```bash
curl -k -i \
  -c /tmp/daka-cookies.txt \
  -X POST https://localhost:8443/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "soft-delete-test@example.com",
    "password": "SoftDelete-Test-123"
  }'
```

Resultado esperado:

```http
200 OK
```

O cookie `daka_session` será guardado em `/tmp/daka-cookies.txt`.

### 5. Criar um listing de teste

```bash
curl -k -i \
  -b /tmp/daka-cookies.txt \
  -X POST https://localhost:8443/api/listings \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Temporary listing",
    "category_id": 1,
    "condition_id": 1,
    "listing_dsc": "Created for soft delete testing",
    "listing_location": "Test",
    "wish": "Nothing"
  }'
```

Resultado esperado:

```http
201 Created
```

### 6. Executar o soft delete

```bash
curl -k -i \
  -b /tmp/daka-cookies.txt \
  -X DELETE \
  https://localhost:8443/api/auth/me
```

Resultado esperado:

```http
204 No Content
```

### 7. Verificar o usuário no MariaDB

Entrar no banco:

```bash
docker exec -it daka_db mariadb -u root -p daka
```

Executar:

```sql
SELECT
    id,
    user_name,
    email,
    deleted_at
FROM users
WHERE email = 'soft-delete-test@example.com';
```

O usuário deve continuar no banco com `deleted_at` preenchido.

### 8. Verificar o listing

```sql
SELECT
    l.id,
    l.user_id,
    ls.state_name
FROM listings l
JOIN listings_states ls
    ON ls.id = l.state_id
WHERE l.user_id = (
    SELECT id
    FROM users
    WHERE email = 'soft-delete-test@example.com'
);
```

O listing deve permanecer no banco com:

```text
state_name = Removed
```

### 9. Verificar as sessões

```sql
SELECT *
FROM sessions
WHERE user_id = (
    SELECT id
    FROM users
    WHERE email = 'soft-delete-test@example.com'
);
```

O resultado deve ser vazio.

### 10. Confirmar que a conta não pode mais fazer login

```bash
curl -k -i \
  -X POST https://localhost:8443/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "soft-delete-test@example.com",
    "password": "SoftDelete-Test-123"
  }'
```

Resultado esperado:

```http
401 Unauthorized
```

## Validações realizadas

A implementação foi validada com:

- compilação Python;
- `git diff --check`;
- migration aplicada no MariaDB;
- backend iniciado como `healthy`;
- MariaDB iniciado como `healthy`;
- resposta `200` no endpoint `/api/health`;
- cadastro de usuário temporário;
- login do usuário temporário;
- criação de listing;
- resposta `204` na exclusão da conta;
- `deleted_at` preenchido no banco;
- listing preservado com estado `Removed`;
- sessões removidas;
- login posterior rejeitado com `401`.
