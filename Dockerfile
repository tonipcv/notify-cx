FROM node:18-alpine

WORKDIR /app

# Copiar arquivos de dependências
COPY package*.json ./
COPY prisma ./prisma/

# Instalar dependências
RUN npm install

# Copiar o resto dos arquivos
COPY . .

# Verificar e mover a chave APNs para o local correto
RUN if [ -f "AuthKey_2B7PM6X757.p8" ]; then \
    cp AuthKey_2B7PM6X757.p8 /AuthKey_2B7PM6X757.p8; \
    echo "APNs key copied to root directory"; \
    else \
    echo "APNs key not found in build context"; \
    fi

# Verificar e mover o arquivo de credenciais do Firebase para o local correto
RUN if [ -f "firebase-service-account.json" ]; then \
    cp firebase-service-account.json /firebase-service-account.json; \
    echo "Firebase credentials copied to root directory"; \
    else \
    echo "Firebase credentials not found in build context"; \
    fi

# Gerar Prisma Client
RUN npx prisma generate

# Adicionar script para migração do banco
COPY docker-entrypoint.sh /
RUN chmod +x /docker-entrypoint.sh

# Expor a porta
EXPOSE 3000

# Comando para iniciar
ENTRYPOINT ["/docker-entrypoint.sh"]