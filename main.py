import os
import requests
import threading
import speedtest
import time
import re
import random
import string
import math
import asyncio
from urllib.parse import unquote
from flask import Flask
from pyrogram import Client, filters
from pyrogram.types import InlineKeyboardMarkup, InlineKeyboardButton

# --- සර්වර් එක Online තබා ගැනීමට (Keep-Alive) ---
flask_app = Flask(__name__)
@flask_app.route('/')
def home(): return "බොට් සාර්ථකව ක්‍රියාත්මකයි! 🚀"

def run_flask(): 
    flask_app.run(host='0.0.0.0', port=8000)

# --- Global Variables & Limits ---
is_stopped = False
last_update_time = 0
user_temp_data = {} 
MAX_SINGLE_SIZE = 1.9 * 1024 * 1024 * 1024  # 1.9GB
SPLIT_CHUNK_SIZE = 500 * 1024 * 1024        # 500MB

# --- Temp Mail Functions ---
def generate_random_string(length=10):
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=length))

def create_mail():
    try:
        domain_res = requests.get("https://api.mail.tm/domains").json()
        domain = domain_res['hydra:member'][0]['domain']
        email = f"{generate_random_string()}@{domain}"
        password = "password123"
        data = {"address": email, "password": password}
        res = requests.post("https://api.mail.tm/accounts", json=data)
        if res.status_code == 201:
            token_res = requests.post("https://api.mail.tm/token", json=data).json()
            return email, token_res['token']
    except: pass
    return None, None

def check_inbox_api(token):
    headers = {"Authorization": f"Bearer {token}"}
    res = requests.get("https://api.mail.tm/messages", headers=headers)
    if res.status_code == 200:
        msgs = res.json().get('hydra:member', [])
        detailed_messages = []
        for m in msgs[:3]:
            m_id = m['id']
            m_res = requests.get(f"https://api.mail.tm/messages/{m_id}", headers=headers).json()
            detailed_messages.append(m_res)
        return detailed_messages
    return []

# --- Progress Bar Function ---
async def progress(current, total, message, type_msg, fn):
    global last_update_time, is_stopped
    if is_stopped: raise Exception("STOPPED_BY_USER")
    now = time.time()
    if now - last_update_time < 5 and current != total: return
    last_update_time = now
    if total <= 0: return
    percent = current * 100 / total
    progress_bar = "".join(["▰" if i < int(percent / 10) else "▱" for i in range(10)])
    try:
        await message.edit(
            f"**{type_msg}:** `{fn}`\n"
            f"📊 `{progress_bar}` **{percent:.1f}%**\n"
            f"📦 **{current/(1024*1024):.1f}MB** / **{total/(1024*1024):.1f}MB**"
        )
    except: pass

# --- Configurations ---
API_ID = os.environ.get("API_ID")
API_HASH = os.environ.get("API_HASH")
BOT_TOKEN = os.environ.get("BOT_TOKEN")

app = Client("remote_download_bot", api_id=API_ID, api_hash=API_HASH, bot_token=BOT_TOKEN)

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
}

def get_filename(url, headers):
    cd = headers.get('content-disposition')
    if cd:
        fname = re.findall(r'filename\*?=["\']?(?:UTF-8\'\')?([^"\';\n]+)', cd)
        if fname: 
            name = unquote(fname[0].strip())
            return name.replace("/", "_").replace("\\", "_")
    name = url.split("/")[-1].split("?")[0]
    name = unquote(name) if name and "." in name else f"file_{int(time.time())}.zip"
    return name.replace("/", "_").replace("\\", "_")

# ================= COMMANDS =================

@app.on_message(filters.command("start") & filters.private)
async def start(client, message):
    await message.reply(
        "👋 **ආයුබෝවන් ප්‍රවීන්!**\n\n"
        "⚡ `/download [links]` - ලින්ක් download කිරීමට\n"
        "⚡ `/speed` - සර්වර් වේගය පරීක්ෂාවට\n"
        "📧 `/tempmail` - තාවකාලික ඊමේල් සෑදීමට\n"
        "🛑 `/stop` - දැනට පවතින වැඩ නවත්වන්න"
    )

@app.on_message(filters.command("speed") & filters.private)
async def test_speed(client, message):
    msg = await message.reply("⚡ වේගය පරීක්ෂා කරමින් පවතී...")
    try:
        st = speedtest.Speedtest(secure=True)
        st.get_best_server()
        await msg.edit(
            f"🚀 **Server Speed Test:**\n\n"
            f"📡 **Ping : ** `{st.results.ping:.2f} ms`\n"
            f"⬇️ **Download : ** `{st.download()/1e6:.2f} Mbps`\n"
            f"⬆️ **Upload : ** `{st.upload()/1e6:.2f} Mbps`"
        )
    except Exception as e: await msg.edit(f"❌ Speed Test Error: {e}")

@app.on_message(filters.command("stop") & filters.private)
async def stop_handler(client, message):
    global is_stopped
    is_stopped = True
    await message.reply("🛑 **Stopped!** දැනට පවතින වැඩය නවතා සර්වර් එක Clear කරනු ඇත.")

@app.on_message(filters.command("tempmail") & filters.private)
async def get_temp(client, message):
    m = await message.reply("අලුත් Temp Mail එකක් සාදමින්... 📧")
    email, token = create_mail()
    if email:
        user_temp_data[message.chat.id] = {"email": email, "token": token}
        keyboard = InlineKeyboardMarkup([[InlineKeyboardButton("📥 Inbox පරීක්ෂා කරන්න", callback_data="check_inbox")]])
        await m.edit(f"✅ **ඔබේ තාවකාලික ඊමේල් ලිපිනය:**\n`{email}`", reply_markup=keyboard)
    else: await m.edit("❌ ඊමේල් එක සෑදීමට නොහැකි වුණා.")

@app.on_callback_query(filters.regex("^check_inbox$"))
async def check_inbox_callback(client, callback_query):
    data = user_temp_data.get(callback_query.message.chat.id)
    if not data: return await callback_query.answer("❌ සක්‍රීය ඊමේල් එකක් නැත.", show_alert=True)
    try:
        messages = check_inbox_api(data["token"])
        if not messages:
            return await callback_query.message.edit_text(f"✅ **Email:** `{data['email']}`\n\n📭 **Inbox හිස්.**", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔄 Refresh", callback_data="check_inbox")]]))
        text = f"✅ **Email:** `{data['email']}`\n\n**📥 පණිවිඩ:**\n\n"
        for msg in messages:
            text += f"👤 **From:** `{msg['from']['address']}`\n📝 **Subject:** `{msg['subject']}`\n📄 **Msg:** `{msg.get('text', '')[:500]}`\n━━━━━━━━━━━━\n"
        await callback_query.message.edit_text(text, reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔄 Refresh", callback_data="check_inbox")]]))
    except: await callback_query.answer("❌ දෝෂයක් මතු විය.")

# --- Improved Download System ---
@app.on_message(filters.command("download") & filters.private)
async def dl_handler(client, message):
    global is_stopped
    is_stopped = False
    links = message.text.split()[1:]
    if not links: return await message.reply("භාවිතය: `/download link`")

    for link in links:
        if is_stopped: break
        s_msg = await message.reply(f"🔗 සම්බන්ධ වෙමින්: `{link}`")
        fn = None
        try:
            head = requests.head(link, headers=HEADERS, allow_redirects=True, timeout=15)
            total_size = int(head.headers.get('content-length', 0))
            fn = get_filename(link, head.headers)
            
            # Logic selecting chunk size
            if total_size > MAX_SINGLE_SIZE:
                active_chunk = SPLIT_CHUNK_SIZE
                num_chunks = math.ceil(total_size / active_chunk)
                await s_msg.edit(f"📦 විශාල ෆයිල් එකක්. කොටස් {num_chunks} කට (500MB බැගින්) බෙදා බාගත කරයි...")
            else:
                active_chunk = total_size
                num_chunks = 1

            for i in range(num_chunks):
                if is_stopped: break
                
                start = i * active_chunk
                end = min(start + active_chunk - 1, total_size - 1) if total_size > 0 else None
                
                part_fn = f"part_{i+1}_{fn}" if num_chunks > 1 else fn
                r_headers = {**HEADERS, 'Range': f'bytes={start}-{end}'} if num_chunks > 1 else HEADERS
                
                # Download Part
                with requests.get(link, headers=r_headers, stream=True, timeout=30) as r:
                    r.raise_for_status()
                    p_size = int(r.headers.get('content-length', 0))
                    with open(part_fn, 'wb') as f:
                        dl = 0
                        for chunk in r.iter_content(chunk_size=512*1024): # Smaller chunk size for stability
                            if is_stopped: raise Exception("STOPPED_BY_USER")
                            if chunk:
                                f.write(chunk)
                                dl += len(chunk)
                                label = f"📥 Part {i+1}/{num_chunks}" if num_chunks > 1 else "📥 Downloading"
                                await progress(dl, p_size, s_msg, label, part_fn)
                                await asyncio.sleep(0.01) # හිරවීම වැළැක්වීමට විවේකයක් ලබාදීම

                # Upload Part
                await client.send_document(
                    message.chat.id, 
                    document=part_fn, 
                    caption=f"✅ `{fn}`" + (f" - Part {i+1}/{num_chunks}" if num_chunks > 1 else ""),
                    progress=progress, 
                    progress_args=(s_msg, f"📤 Uploading" + (f" Part {i+1}" if num_chunks > 1 else ""), part_fn)
                )
                if os.path.exists(part_fn): os.remove(part_fn)
                await asyncio.sleep(1) # Upload අතර පොඩි පරතරයක්

            await s_msg.delete()
        except Exception as e:
            err_msg = str(e)
            if err_msg == "STOPPED_BY_USER": await s_msg.edit("🛑 Stopped!")
            else: await s_msg.edit(f"❌ Error: {err_msg}")
            # Cleanup
            for f in os.listdir("."):
                if f.startswith("part_") or (fn and f == fn):
                    try: os.remove(f)
                    except: pass
            break

    if not is_stopped: await message.reply("✅ සියලුම වැඩ අවසන්!")

if __name__ == "__main__":
    threading.Thread(target=run_flask, daemon=True).start()
    app.run()
