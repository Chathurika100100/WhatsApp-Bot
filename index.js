const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

// Railway එකේ දාන Session ID එක ෆයිල් එකක් බවට පත් කිරීම
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
                             `👉 📥 \`.sg [GroupName] [Link1] [Link2]\` - ලින්ක් මඟින් ගොනු ඩවුන්ලෝඩ් කර අදාළ සමූහයට යැවීමට.\n\n` +
                             `_𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games_`;
                             
            await sock.sendMessage(from, { text: menuText }, { quoted: msg });
            return;
        }

        // 2. SPEED TEST COMMAND (.speed)
        if (text === '.speed') {
            await sock.sendMessage(from, { text: '⚡ වේගය පරීක්ෂා කරමින් පවතී, කරුණාකර රැඳී සිටින්න...' }, { quoted: msg });
            
            try {
                // Ping පරීක්ෂා කිරීම
                const pingStart = performance.now();
                await axios.get('https://www.google.com');
                const ping = (performance.now() - pingStart).toFixed(0);

                // Download Speed පරීක්ෂා කිරීම (Cloudflare එකෙන් 1MB එකක් බාගත කිරීම)
                const dlStart = performance.now();
                await axios.get('https://speed.cloudflare.com/__down?bytes=1048576', { responseType: 'arraybuffer' });
                const dlEnd = performance.now();
                const dlTime = (dlEnd - dlStart) / 1000; 
                const downloadSpeed = (1 / dlTime).toFixed(2); // MB/s වලින්

                // Upload Speed පරීක්ෂා කිරීම (1MB ඩමි බෆර් එකක් HTTPBin එකට අප්ලෝඩ් කිරීම)
                const ulStart = performance.now();
                const dummyBuffer = Buffer.alloc(1048576); 
                await axios.post('https://httpbin.org/post', dummyBuffer);
                const ulEnd = performance.now();
                const ulTime = (ulEnd - ulStart) / 1000;
                const uploadSpeed = (1 / ulTime).toFixed(2); // MB/s වලින්

                const speedResult = `⚡ *𝚂𝙴𝚁𝚅𝙴𝚁 𝚂𝙿𝙴𝙴𝙳 𝚃𝙴𝚂𝚃 𝚁𝙴𝚂𝚄𝙻𝚃𝚂*\n\n` +
                                    `🔹 *Ping:* ${ping} ms\n` +
                                    `🔹 *Download Speed:* ${downloadSpeed} MB/s\n` +
                                    `🔹 *Upload Speed:* ${uploadSpeed} MB/s\n\n` +
                                    `_𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games_`;

                await sock.sendMessage(from, { text: speedResult }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ වේගය මැනීමේදී දෝෂයක් ඇති විය: ${err.message}` }, { quoted: msg });
            }
            return;
        }

        // 3. FILE DOWNLOAD & FORWARD (.sg)
        if (text.startsWith('.sg ')) {
            const args = text.slice(4).trim().split(/\s+/);
            if (args.length < 2) {
                await sock.sendMessage(from, { text: '❌ කරුණාකර නිවැරදිව ඇතුලත් කරන්න.\nනියැදිය: .sg [GroupName] [Link1]' }, { quoted: msg });
                return;
            }

            const groupNameInput = args[0].replace('[', '').replace(']', '');
            const links = args.slice(1).map(l => l.replace('[', '').replace(']', ''));

            await sock.sendMessage(from, { text: `⏳ '${groupNameInput}' සමූහය සොයමින් පවතී...` }, { quoted: msg });

            try {
                const getGroups = await sock.groupFetchAllParticipating();
                const groups = Object.values(getGroups);
                const targetGroup = groups.find(g => g.subject.toLowerCase() === groupNameInput.toLowerCase());

                if (!targetGroup) {
                    await sock.sendMessage(from, { text: `❌ '${groupNameInput}' නමින් සමූහයක් සොයාගත නොහැකි විය!` }, { quoted: msg });
                    return;
                }

                for (let i = 0; i < links.length; i++) {
                    const link = links[i];
                    try {
                        await sock.sendMessage(from, { text: `📥 ගොනුව බාගත වෙමින් පවතී (${i + 1}/${links.length}): ${link}` });
                        
                        const response = await axios({ method: 'get', url: link, responseType: 'arraybuffer' });
                        const buffer = Buffer.from(response.data, 'binary');
                        const fileName = path.basename(new URL(link).pathname) || `file_${Date.now()}`;

                        // ගෲප් එකට ෆයිල් එක සහ Caption (Watermark) එක යැවීම
                        await sock.sendMessage(targetGroup.id, {
                            document: buffer,
                            fileName: fileName,
                            mimetype: response.headers['content-type'] || 'application/octet-stream',
                            caption: `*𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games*` // මෙතනින් Watermark එක එකතු වේ
                        });
                    } catch (err) {
                        await sock.sendMessage(from, { text: `❌ දෝෂයකි (Link ${i+1}): ${err.message}` });
                    }
                }
                await sock.sendMessage(from, { text: '✅ සියලුම ගොනු සමූහයට සාර්ථකව යවන ලදී!' }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(from, { text: `❌ පද්ධති දෝෂයකි: ${error.message}` }, { quoted: msg });
            }
        }
    });
}

startBot();
