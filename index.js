const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

// Railway හෝ Koyeb එකේ දාන Session ID එක ෆයිල් එකක් බවට පත් කිරීම
if (process.env.SESSION_ID) {
    if (!fs.existsSync('./session')) {
        fs.mkdirSync('./session');
    }
    try {
        const decryptedCreds = Buffer.from(process.env.SESSION_ID, 'base64').toString('utf-8');
        JSON.parse(decryptedCreds); 
        fs.writeFileSync('./session/creds.json', decryptedCreds);
    } catch (e) {
        fs.writeFileSync('./session/creds.json', process.env.SESSION_ID);
    }
}

// Temporary ෆෝල්ඩර් එක නිර්මාණය කිරීම (ලොකු ෆයිල් තියාගන්න)
const tempFolder = './temp_downloads';
if (!fs.existsSync(tempFolder)) {
    fs.mkdirSync(tempFolder);
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./session');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect.error?.output?.statusCode || lastDisconnect.error?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`සම්බන්ධතාවය බිඳ වැටුණා (Status: ${statusCode}). නැවත උත්සාහ කරයි...`, shouldReconnect);
            if (shouldReconnect) {
                setTimeout(() => startBot(), 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Bot සාර්ථකව සම්බන්ධ වුණා!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const from = msg.key.remoteJid;

        // 1. MENU COMMAND (.menu)
        if (text === '.menu') {
            const menuText = `🤖 *𝚁𝚅 𝙶𝙰𝙼𝙴𝚂 𝚆𝙷𝙰𝚃𝚂𝙰𝙿𝙿 𝙱𝙾𝚃* 🤖\n\n` +
                             `👋 ආයුබෝවන්! මෙන්න මගේ විධානයන් (Commands) ලැයිස්තුව:\n\n` +
                             `⚙️ *ප්‍රධාන විධානයන්:*\n` +
                             `👉 📄 \`.menu\` - මෙම මෙනුව ලබා ගැනීමට.\n` +
                             `👉 ⚡ \`.speed\` - සර්වර් එකේ වේගය (Speed Test) බැලීමට.\n` +
                             `👉 📥 \`.sg [GroupName] [Link1] [Link2]\` - ලින්ක් มඟින් ගොනු ඩවුන්ලෝඩ් කර අදාළ සමූහයට යැවීමට.\n\n` +
                             `_𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games_`;
                             
            await sock.sendMessage(from, { text: menuText }, { quoted: msg });
            return;
        }

        // 2. SPEED TEST COMMAND (.speed)
        if (text === '.speed') {
            await sock.sendMessage(from, { text: '⚡ වේගය පරීක්ෂා කරමින් පවතී, කරුණාකර රැඳී සිටින්න...' }, { quoted: msg });
            
            try {
                const pingStart = performance.now();
                await axios.get('https://www.google.com');
                const ping = (performance.now() - pingStart).toFixed(0);

                // Download Speed Test (Mbps වලින්)
                const dlStart = performance.now();
                await axios.get('https://speed.cloudflare.com/__down?bytes=1048576', { responseType: 'arraybuffer' });
                const dlEnd = performance.now();
                const dlTime = (dlEnd - dlStart) / 1000; 
                const downloadSpeed = ((1 / dlTime) * 8).toFixed(2); 

                // Upload Speed Test (Mbps වලින්)
                const ulStart = performance.now();
                const dummyBuffer = Buffer.alloc(1048576); 
                await axios.post('https://httpbin.org/post', dummyBuffer);
                const ulEnd = performance.now();
                const ulTime = (ulEnd - ulStart) / 1000;
                const uploadSpeed = ((1 / ulTime) * 8).toFixed(2); 

                const speedResult = `⚡ *𝚂𝙴𝚁𝚅𝙴𝚁 𝚂𝙿𝙴𝙴𝙳 𝚃𝙴𝚂𝚃 𝚁𝙴𝚂𝚄𝙻𝚃𝚂*\n\n` +
                                    `🔹 *Ping:* ${ping} ms\n` +
                                    `🔹 *Download Speed:* ${downloadSpeed} Mbps\n` +
                                    `🔹 *Upload Speed:* ${uploadSpeed} Mbps\n\n` +
                                    `_𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games_`;

                await sock.sendMessage(from, { text: speedResult }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ වේගය මැනීමේදී දෝෂයක් ඇති විය: ${err.message}` }, { quoted: msg });
            }
            return;
        }

        // 3. FILE DOWNLOAD & FORWARD (.sg) - ලොකු ෆයිල් සඳහා සකස් කරන ලද කොටස
        if (text.startsWith('.sg ')) {
            const commandBody = text.slice(4).trim();
            
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const links = commandBody.match(urlRegex) || [];
            
            let groupNameInput = commandBody.replace(urlRegex, '').trim();
            groupNameInput = groupNameInput.replace(/[\[\]]/g, '').trim();

            if (!groupNameInput || links.length === 0) {
                await sock.sendMessage(from, { text: '❌ කරුණාකර නිවැරදිව ඇතුලත් කරන්න.\nනියැදිය: .sg RV Games https://link1.com' }, { quoted: msg });
                return;
            }

            await sock.sendMessage(from, { text: `⏳ '${groupNameInput}' සමූහය සොයමින් පවතී...` }, { quoted: msg });

            try {
                const getGroups = await sock.groupFetchAllParticipating();
                const groups = Object.values(getGroups);
                const targetGroup = groups.find(g => g.subject.toLowerCase().trim() === groupNameInput.toLowerCase());

                if (!targetGroup) {
                    await sock.sendMessage(from, { text: `❌ '${groupNameInput}' නමින් සමූහයක් සොයාගත නොහැකි විය!` }, { quoted: msg });
                    return;
                }

                const jobStartTime = performance.now();
                const totalLinks = links.length;

                for (let i = 0; i < totalLinks; i++) {
                    const link = links[i];
                    let tempFilePath = '';
                    
                    try {
                        await sock.sendMessage(from, { text: `📥 ගොනුව බාගත වෙමින් පවතී (${i + 1}/${totalLinks}):\n🔗 ${link}` });
                        
                        // ෆයිල් එකේ නම වෙන්කර ගැනීම
                        let fileName = `file_${Date.now()}`;
                        try {
                            const parsedUrl = new URL(link);
                            fileName = path.basename(parsedUrl.pathname) || fileName;
                        } catch (e) {}

                        tempFilePath = path.join(tempFolder, fileName);

                        // ⚡ RAM එක බේරාගෙන කෙලින්ම Disk එකට Stream එකක් මඟින් ලොකු ෆයිල් ඩවුන්ලෝඩ් කිරීම
                        const response = await axios({
                            method: 'get',
                            url: link,
                            responseType: 'stream',
                            maxContentLength: Infinity,
                            maxBodyLength: Infinity,
                            timeout: 0 // ලොකු ෆයිල් නිසා ටයිම් අවුට් වීම වැළැක්වීම
                        });

                        const writer = fs.createWriteStream(tempFilePath);
                        response.data.pipe(writer);

                        await new Promise((resolve, reject) => {
                            writer.on('finish', resolve);
                            writer.on('error', reject);
                        });

                        // 📤 Baileys හරහා ලෝකල් ෆයිල් එකක් ලෙස ගෲප් එකට සෙන්ඩ් කිරීම (RAM වැය නොවේ)
                        await sock.sendMessage(targetGroup.id, {
                            document: { url: tempFilePath },
                            fileName: fileName,
                            mimetype: response.headers['content-type'] || 'application/octet-stream',
                            caption: `*𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games*`
                        });

                        // 🗑️ යවා අවසන් වූ වහාම සර්වර් එකේ ඉඩ ඉතිරි කරගැනීමට ෆයිල් එක මැකීම
                        if (fs.existsSync(tempFilePath)) {
                            fs.unlinkSync(tempFilePath);
                        }

                    } catch (err) {
                        await sock.sendMessage(from, { text: `❌ දෝෂයකි (Link ${i+1}): ${err.message}` });
                        // දෝෂයක් ආවත් ඉතුරු වෙන තාවකාලික ෆයිල් මැකීම
                        if (tempFilePath && fs.existsSync(tempFilePath)) {
                            fs.unlinkSync(tempFilePath);
                        }
                    }
                }

                const jobEndTime = performance.now();
                const timeTaken = ((jobEndTime - jobStartTime) / 1000).toFixed(1);

                const doneMessage = `┏━━━━━━━━━━━━━━━━━━━━━━━┓\n` +
                                    `      ⚙️ *𝚁𝚅 𝙶𝙰𝙼𝙴𝚂* ⚙️\n` +
                                    `┗━━━━━━━━━━━━━━━━━━━━━━━┛\n\n` +
                                    `┌────────────────────────\n` +
                                    `│ ✅ *Status:* Done\n` +
                                    `│ 📦 *Total Parts:* ${totalLinks}\n` +
                                    `│ ⏱️ *Time Taken:* ${timeTaken}s\n` +
                                    `└────────────────────────\n\n` +
                                    `_*𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games*_`;

                await sock.sendMessage(targetGroup.id, { text: doneMessage });
                await sock.sendMessage(from, { text: `✅ සියලුම ගොනු සහ සාරාංශය (Summary) '${targetGroup.subject}' සමූහයට සාර්ථකව යවන ලදී!` }, { quoted: msg });

            } catch (error) {
                await sock.sendMessage(from, { text: `❌ පද්ධති දෝෂයකි: ${error.message}` }, { quoted: msg });
            }
        }
    });
}

startBot();
