# API de Notificações - Documentação

## Índice
- [Visão Geral](#visão-geral)
- [Endpoints](#endpoints)
  - [Health Check](#health-check)
  - [Registro de Dispositivo](#registro-de-dispositivo)
  - [Envio de Notificação](#envio-de-notificação)
  - [Envio de Notificação por Email](#envio-de-notificação-por-email)
  - [Listagem de Dispositivos](#listagem-de-dispositivos)
  - [Teste de Banco de Dados](#teste-de-banco-de-dados)
  - [Teste de Notificação](#teste-de-notificação)
- [Notificações Agendadas](#notificações-agendadas)
- [Códigos de Status](#códigos-de-status)
- [Erros Comuns](#erros-comuns)

## Visão Geral

Esta API fornece serviços de notificação push para dispositivos iOS e Android, com suporte tanto para Firebase Cloud Messaging (FCM) quanto para Expo Push Notifications.

### Base URL
```
http://seu-servidor:3000
```

## Endpoints

### Health Check

```http
GET /health
```

Verifica o status do servidor e suas dependências.

**Resposta de Sucesso (200 OK)**
```json
{
    "status": "ok",
    "timestamp": "2024-01-01T12:00:00.000Z",
    "env": "development",
    "server": "running",
    "database": "connected"
}
```

### Registro de Dispositivo

```http
POST /register-device
```

Registra um novo dispositivo para receber notificações.

**Payload**
```json
{
    "deviceToken": "string (obrigatório)",
    "userId": "string (opcional, default: 'anônimo')",
    "email": "string (opcional)",
    "platform": "string (opcional, default: 'ios')"
}
```

**Resposta de Sucesso (200 OK)**
```json
{
    "success": true,
    "message": "Dispositivo registrado com sucesso",
    "data": {
        "deviceToken": "string",
        "userId": "string",
        "email": "string",
        "platform": "string",
        "lastUpdated": "2024-01-01T12:00:00.000Z"
    }
}
```

### Envio de Notificação

```http
POST /send-notification
```

Envia uma notificação para todos os dispositivos registrados.

**Payload**
```json
{
    "title": "string (opcional)",
    "message": "string (obrigatório)"
}
```

**Resposta de Sucesso (200 OK)**
```json
{
    "success": true,
    "message": "Notificação enviada com sucesso",
    "deviceCount": 10,
    "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### Envio de Notificação por Email

```http
POST /send-notification-by-email
```

Envia notificações para dispositivos associados a emails específicos.

**Payload**
```json
{
    "emails": ["email1@exemplo.com", "email2@exemplo.com"] // ou string para um único email
    "message": "string (obrigatório)",
    "title": "string (opcional)"
}
```

**Resposta de Sucesso (200 OK, 207 Multi-Status)**
```json
{
    "success": true,
    "summary": {
        "totalEmails": 2,
        "successfulEmails": 1,
        "failedEmails": 1,
        "totalDevices": 3
    },
    "successful": [
        {
            "email": "email1@exemplo.com",
            "deviceCount": 3,
            "timestamp": "2024-01-01T12:00:00.000Z"
        }
    ],
    "failed": [
        {
            "email": "email2@exemplo.com",
            "error": "Nenhum dispositivo encontrado",
            "timestamp": "2024-01-01T12:00:00.000Z"
        }
    ],
    "deviceDetails": {
        "email1@exemplo.com": {
            "deviceCount": 3,
            "devices": [
                {
                    "platform": "ios",
                    "lastUpdated": "2024-01-01T12:00:00.000Z",
                    "tokenType": "Firebase"
                }
            ]
        }
    },
    "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### Listagem de Dispositivos

```http
GET /devices
```

Lista todos os dispositivos registrados.

**Resposta de Sucesso (200 OK)**
```json
{
    "count": 10,
    "devices": [
        {
            "deviceToken": "string",
            "userId": "string",
            "email": "string",
            "platform": "string",
            "lastUpdated": "2024-01-01T12:00:00.000Z"
        }
    ]
}
```

### Teste de Banco de Dados

```http
GET /db-test
```

Testa a conexão com o banco de dados.

**Resposta de Sucesso (200 OK)**
```json
{
    "success": true,
    "count": 10,
    "connection": "OK",
    "devices": [/* array de dispositivos */]
}
```

### Teste de Notificação

```http
POST /send-test-notification
```

Envia uma notificação de teste para um usuário específico.

**Payload**
```json
{
    "userId": "string (obrigatório)",
    "message": "string (opcional)",
    "title": "string (opcional)"
}
```

**Resposta de Sucesso (200 OK)**
```json
{
    "success": true,
    "message": "Notificações enviadas com sucesso",
    "deviceCount": 2,
    "iosCount": 1,
    "expoCount": 1
}
```

## Notificações Agendadas

O sistema inclui um serviço de notificações agendadas que envia automaticamente mensagens para todos os dispositivos registrados em horários específicos.

### Notificação Diária de Protocolo

Uma notificação é enviada automaticamente todos os dias às 16:00 (horário de Brasília) para todos os dispositivos registrados.

**Detalhes da Notificação:**
```json
{
    "title": "Attention",
    "body": "Complete your protocol today to get closer to your ultimate goal!",
    "data": {
        "messageType": "daily_reminder",
        "timestamp": "2024-01-01T16:00:00.000Z"
    }
}
```

**Características:**
- Horário: 16:00 (Brasília)
- Frequência: Diária
- Destinatários: Todos os dispositivos registrados
- Tipo: Push Notification (Firebase e Expo)
- Som: Padrão
- Badge: 1

**Observações:**
1. O serviço inicia automaticamente com o servidor
2. Usa o fuso horário America/Sao_Paulo
3. Logs detalhados são gerados para cada envio
4. Em caso de falha, tentará novamente no próximo ciclo

## Códigos de Status

- `200 OK`: Requisição bem-sucedida
- `207 Multi-Status`: Sucesso parcial (alguns emails falharam)
- `400 Bad Request`: Parâmetros inválidos ou faltando
- `404 Not Found`: Recurso não encontrado
- `500 Internal Server Error`: Erro interno do servidor

## Erros Comuns

1. **Token Inválido**
```json
{
    "success": false,
    "error": "Token inválido",
    "details": "O token fornecido não é válido ou expirou"
}
```

2. **Dispositivo Não Encontrado**
```json
{
    "success": false,
    "error": "Nenhum dispositivo encontrado",
    "details": "Não há dispositivos registrados para este usuário/email"
}
```

3. **Parâmetros Faltando**
```json
{
    "success": false,
    "error": "Parâmetros obrigatórios faltando",
    "details": "Campo X é obrigatório"
}
``` 