# Sistema de Notificações Telegram via Firebase Cloud Messaging

Este sistema recebe mensagens do Telegram via webhook e envia notificações push para dispositivos iOS e Android usando o Firebase Cloud Messaging (FCM).

## Funcionalidades

- Recebe mensagens do Telegram via webhook
- Envia notificações push para dispositivos iOS e Android via Firebase Cloud Messaging
- Registra dispositivos para receber notificações
- Gerencia tokens de dispositivos (remove tokens inválidos automaticamente)
- Rotas para testar o envio de notificações e verificar a conexão com o banco de dados

## Requisitos

- Node.js (versão 14 ou superior)
- Banco de dados PostgreSQL
- Conta no Firebase com Firebase Cloud Messaging habilitado
- Bot do Telegram

## Configuração

1. Clone o repositório
2. Instale as dependências:
   ```
   npm install
   ```
3. Configure as variáveis de ambiente:
   - Copie o arquivo `.env.example` para `.env`
   - Preencha as variáveis de ambiente necessárias

### Configuração do Firebase

Você tem duas opções para configurar o Firebase:

1. **Usando um arquivo de configuração**:
   - Baixe o arquivo de configuração do Firebase Console (Configurações do Projeto > Contas de Serviço > Gerar nova chave privada)
   - Salve o arquivo como `firebase-service-account.json` na raiz do projeto

2. **Usando variáveis de ambiente**:
   - Configure as seguintes variáveis no arquivo `.env`:
     ```
     FIREBASE_PROJECT_ID=seu_project_id
     FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nSua_Chave_Privada_Aqui\n-----END PRIVATE KEY-----\n"
     FIREBASE_CLIENT_EMAIL=seu_client_email@seu_projeto.iam.gserviceaccount.com
     ```

### Configuração do Banco de Dados

Configure a variável `DATABASE_URL` no arquivo `.env` com a URL de conexão do seu banco de dados PostgreSQL.

### Configuração do Webhook do Telegram

1. Crie um bot no Telegram usando o BotFather
2. Configure a variável `TELEGRAM_BOT_TOKEN` no arquivo `.env` com o token do seu bot
3. Configure a variável `WEBHOOK_URL` no arquivo `.env` com a URL pública do seu servidor (ex: `https://seu-dominio.com/telegram-webhook`)
4. Acesse a rota `/setup-webhook` para configurar o webhook do Telegram

## Uso

### Iniciar o servidor

```
npm start
```

### Registrar um dispositivo

```
POST /register-device
Content-Type: application/json

{
  "deviceToken": "token_do_dispositivo",
  "userId": "id_do_usuario",
  "platform": "ios" ou "android"
}
```

### Testar o envio de notificações

```
POST /send-test-notification
Content-Type: application/json

{
  "userId": "id_do_usuario",
  "message": "Mensagem de teste",
  "title": "Título da notificação"
}
```

### Verificar a conexão com o banco de dados

```
GET /db-test
```

## Rotas

- `GET /` - Página inicial
- `GET /health` - Verificar status do servidor
- `POST /register-device` - Registrar um dispositivo
- `POST /telegram-webhook` - Webhook do Telegram
- `GET /setup-webhook` - Configurar webhook do Telegram
- `POST /send-test-notification` - Testar envio de notificações
- `GET /db-test` - Testar conexão com banco de dados

## Estrutura do Banco de Dados

O sistema utiliza o Prisma ORM para gerenciar o banco de dados. A estrutura do banco é definida no arquivo `prisma/schema.prisma`.

```prisma
model DeviceToken {
  id           String   @id @default(uuid())
  deviceToken  String   @unique
  userId       String   @default("anônimo")
  platform     String   @default("ios")
  registeredAt DateTime @default(now())
}
```

## Docker

O sistema inclui um Dockerfile para facilitar a implantação. Para construir e executar o contêiner:

```
docker build -t telegram-fcm-notifications .
docker run -p 3000:3000 --env-file .env telegram-fcm-notifications
```
