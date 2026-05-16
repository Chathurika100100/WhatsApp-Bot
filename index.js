const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Boom } = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Railway එකේ දාන Session ID එක ෆයිල් එකක් බවට පත් කිරීම
if (process.env.SESSION_ID) {
    if (!fs.existsSync('./session')) {
        fs.mkdirSync('./session');
    }
    try {
        const decryptedCreds = Buffer.from(process.env.SESSION_ID, 'base64').toString('utf-8');
        // එය නිවැරදි JSON එකක්දැයි පරීක්ෂා කිරීම
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
        // WhatsApp සර්වර් එකෙන් බ්ලොක් නොවීම සඳහා Desktop Web Version එකක් ලබාදීම
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect.error?.output?.statusCode || lastDisconnect.error?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            console.log(`සම්බන්ධතාවය බිඳ වැටුණා (Status: ${statusCode}). නැවත උත්සාහ කරයි...`, shouldReconnect);
            
            // කෙලින්ම ලූප් නොවී තත්පර 5ක් ප්‍රමාද වී නැවත සම්බන්ධ වීම
            if (shouldReconnect) {
                setTimeout(() => startBot(), 5000);
            } else {
                console.log('❌ Session ID එක වැඩ කරන්නේ නැත හෝ Expire වී ඇත. කරුණාකර අලුත් එකක් දමන්න.');
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Bot සාර්ථකව සම්බන්ධ වුණා!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return; // තමන්ගෙන්ම ලූප් වීම වැළැක්වීමට

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        
        if (text.startsWith('.sg ')) {
            const args = text.slice(4).trim().split(/\s+/);
            if (args.length < 2) {
                await sock.sendMessage(msg.key.remoteJid, { text: '❌ කරුණාකර නිවැරදිව ඇතුලත් කරන්න.\nනියැදිය: .sg [GroupName] [Link1]' }, { quoted: msg });
                return;
            }

            const groupNameInput = args[0].replace('[', '').replace(']', '');
            const links = args.slice(1).map(l => l.replace('[', '').replace(']', ''));

            await sock.sendMessage(msg.key.remoteJid, { text: `⏳ '${groupNameInput}' සමූහය සොයමින් පවතී...` }, { quoted: msg });

            try {
                const getGroups = await sock.groupFetchAllParticipating();
                const groups = Object.values(getGroups);
                const targetGroup = groups.find(g => g.subject.toLowerCase() === groupNameInput.toLowerCase());

                if (!targetGroup) {
                    await sock.sendMessage(msg.key.remoteJid, { text: `❌ '${groupNameInput}' නමින් සමූහයක් සොයාගත නොහැකි විය!` }, { quoted: msg });
                    return;
                }

                for (let i = 0; i < links.length; i++) {
                    const link = links[i];
                    try {
                        const response = await axios({ method: 'get', url: link, responseType: 'arraybuffer' });
                        const buffer = Buffer.from(response.data, 'binary');
                        const fileName = path.basename(new URL(link).pathname) || `file_${Date.now()}`;

                        await sock.sendMessage(targetGroup.id, {
                            document: buffer,
                            fileName: fileName,
                            mimetype: response.headers['content-type'] || 'application/octet-stream'
                        });
                    } catch (err) {
                        await sock.sendMessage(msg.key.remoteJid, { text: `❌ දෝෂයකි (Link ${i+1}): ${err.message}` });
                    }
                }
                await sock.sendMessage(msg.key.remoteJid, { text: '✅ සියලුම ගොනු සමූහයට යවන ලදී!' }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(msg.key.remoteJid, { text: `❌ පද්ධති දෝෂයකි: ${error.message}` }, { quoted: msg });
            }
        }
    });
}

startBot();
