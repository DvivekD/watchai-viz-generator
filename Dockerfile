FROM mcr.microsoft.com/playwright:v1.52.0-noble

ENV NODE_ENV=production

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --production

# Install additional fonts for better rendering if needed
RUN apt-get update && apt-get install -y fonts-liberation fonts-noto-color-emoji && rm -rf /var/lib/apt/lists/*

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
