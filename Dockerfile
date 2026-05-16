FROM nikolaik/python-nodejs:python3.10-nodejs20-slim

WORKDIR /app

# Dependencies ෆයිල්ස් සර්වර් එකට කොපි කිරීම
COPY package*.json ./
COPY requirements.txt ./

# Node.js සහ Python dependencies සියල්ලම ඉන්ස්ටෝල් කිරීම
RUN npm install
RUN pip install --no-cache-dir -r requirements.txt

# ඉතිරි සියලුම කෝඩ් සර්වර් එකට කොපි කිරීම
COPY . .

# 🚀 බොට්ලා දෙන්නවම එකවර Background එකේ සහ Foreground එකේ එකට රන් කිරීම
CMD node index.js & python main.py
