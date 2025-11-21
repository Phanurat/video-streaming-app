FROM node:20

# ทำงานใน /usr/src/app
WORKDIR /usr/src/app

# Copy package.json ก่อนเพื่อติดตั้ง dependencies
COPY package*.json ./

# ติดตั้ง dependencies
RUN npm install

# Copy code ที่เหลือ
COPY . .

# เปิด port
EXPOSE 4000

# ใช้ root
USER root

# รัน app
CMD ["node", "server.js"]