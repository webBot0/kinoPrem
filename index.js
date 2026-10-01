const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const http = require('http');
require('dotenv').config();

// 1. Render/Railway Mini-Server
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200);
    res.end("Bot is running...");
}).listen(port, "0.0.0.0", () => {
    console.log(`📡 Mini-server ${port}-portda ishlamoqda`);
});

// 2. MongoDB Initialization
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!MONGO_URI) {
    console.error("❌ XATO: MongoDB o'zgaruvchisi (MONGO_URI) topilmadi!");
    process.exit(1);
}

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB muvaffaqiyatli ulandi"))
    .catch((error) => {
        console.error("❌ MongoDB ulanishda xato:", error.message);
        process.exit(1);
    });

// 3. MongoDB Schemas & Models
const userSchema = new mongoose.Schema({
    userId: { type: Number, required: true, unique: true },
    name: { type: String, default: '' },
    status: { type: String, default: 'active' },
    createdAt: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const channelSchema = new mongoose.Schema({
    channelId: { type: String, required: true },
    link: { type: String, required: true },
    name: { type: String, required: true }
});
const Channel = mongoose.model('Channel', channelSchema);

const channel2Schema = new mongoose.Schema({
    channelId: { type: String, required: true },
    link: { type: String, required: true },
    name: { type: String, required: true }
});
const Channel2 = mongoose.model('Channel2', channel2Schema);

const requestSchema = new mongoose.Schema({
    userId: { type: Number, required: true },
    channelId: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});
requestSchema.index({ userId: 1, channelId: 1 }, { unique: true });
const Request = mongoose.model('Request', requestSchema);

const configSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    mandatoryLink: { type: String, default: '' }
});
const Config = mongoose.model('Config', configSchema);

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = parseInt(process.env.ADMIN_ID);

let adminState = {};

// 4. Yordamchi funksiyalar
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Foydalanuvchi obunasini va zayafkasini tekshirish
async function getUnsubscribedChannels(ctx, collectionName = 'channels') {
    const userId = ctx.from.id;
    const Model = collectionName === 'channels2' ? Channel2 : Channel;
    const channels = await Model.find();
    const unsubscribed = [];

    for (const ch of channels) {
        try {
            const member = await ctx.telegram.getChatMember(ch.channelId, userId);
            const isMember = ['member', 'administrator', 'creator'].includes(member.status);

            if (!isMember) {
                // Agar a'zo bo'lmasa, zayafka yuborganmi tekshiramiz
                const requestDoc = await Request.findOne({ userId: userId, channelId: ch.channelId.toString() });
                if (!requestDoc) {
                    unsubscribed.push(ch);
                }
            }
        } catch (e) {
            // Agar xato bo'lsa (masalan bot kanalda admin emas), zayafkani bazadan tekshiramiz
            const requestDoc = await Request.findOne({ userId: userId, channelId: ch.channelId.toString() });
            if (!requestDoc) {
                unsubscribed.push(ch);
            }
        }
    }
    return unsubscribed;
}

// 5. Start Buyrug'i
async function sendStart(ctx) {
    try {
        const userId = ctx.from.id;
        const userName = ctx.from.first_name || '';

        // Foydalanuvchini saqlash yoki yangilash
        await User.findOneAndUpdate(
            { userId: userId },
            {
                $set: { name: userName, status: 'active', lastActive: new Date() },
                $setOnInsert: { createdAt: new Date() }
            },
            { upsert: true, new: true }
        );

        if (userId === ADMIN_ID) {
            return ctx.reply("🛠 Admin Panelga xush kelibsiz:", Markup.keyboard([
                ['📊 Statistika', '📢 Xabar yuborish'],
                ['➕ Kanal qo\'shish', '🗑 Kanallarni boshqarish'],
                ['➕ Majbur-2 qo\'shish', '🗑 Majbur-2 boshqarish'],
                ['🔗 Majburiy Link']
            ]).resize());
        }

        const unsubbed = await getUnsubscribedChannels(ctx);

        if (unsubbed.length === 0) {
            return ctx.reply(`👋 Xush kelibsiz ${userName}! Marhamat, kino kodini yuboring.`);
        } else {
            const buttons = unsubbed.map((l) => [Markup.button.url(l.name, l.link)]);
            buttons.push([Markup.button.callback("✅ Tekshirish", "check_sub")]);
            return ctx.reply("🔴 Botdan foydalanish uchun quyidagi kanallarga obuna bo'ling yoki so'rov yuboring:", Markup.inlineKeyboard(buttons));
        }
    } catch (e) { console.error("Start Error:", e); }
}

bot.start(sendStart);

// Zayafkalarni tutib qolish
bot.on('chat_join_request', async (ctx) => {
    try {
        const userId = ctx.from.id;
        const channelId = ctx.chat.id.toString();
        await Request.findOneAndUpdate(
            { userId: userId, channelId: channelId },
            { userId: userId, channelId: channelId, timestamp: new Date() },
            { upsert: true, new: true }
        );
    } catch (e) { console.error("Join Request Error:", e); }
});

// 6. Obunani tekshirish (Callback)
bot.action('check_sub', async (ctx) => {
    try {
        const unsubbed = await getUnsubscribedChannels(ctx, 'channels');
        if (unsubbed.length === 0) {
            await ctx.editMessageText("✅ Rahmat! Obuna tasdiqlandi. Endi kod yuborishingiz mumkin.");
        } else {
            const buttons = unsubbed.map((l) => [Markup.button.url(l.name, l.link)]);
            buttons.push([Markup.button.callback("✅ Tekshirish", "check_sub")]);
            
            try {
                await ctx.editMessageReplyMarkup({ inline_keyboard: buttons });
            } catch (err) {
                // Ignore error if markup is the same
            }
            await ctx.answerCbQuery("❌ Shartni to'liq bajaring", { show_alert: true });
        }
    } catch (e) { console.error("Action error:", e); }
});

bot.action('check_sub_2', async (ctx) => {
    try {
        const unsubbed1 = await getUnsubscribedChannels(ctx, 'channels');
        if (unsubbed1.length > 0) {
            const buttons = unsubbed1.map((l) => [Markup.button.url(l.name, l.link)]);
            buttons.push([Markup.button.callback("✅ Tekshirish", "check_sub")]);
            try {
                await ctx.editMessageReplyMarkup({ inline_keyboard: buttons });
            } catch (err) {}
            return ctx.answerCbQuery("❌ Oldin asosiy kanallarga a'zo bo'ling!", { show_alert: true });
        }

        const unsubbed2 = await getUnsubscribedChannels(ctx, 'channels2');
        if (unsubbed2.length === 0) {
            const settings = await Config.findOne({ key: 'settings' });
            const link = settings ? settings.mandatoryLink : null;
            if (link) {
                await ctx.editMessageText(`✅ To'g'ri! Marhamat, kino linki:\n\n${link}`);
            } else {
                await ctx.editMessageText("❌ Xatolik: Admin tomonidan link o'rnatilmagan.");
            }
        } else {
            const buttons = unsubbed2.map((l) => [Markup.button.url(l.name, l.link)]);
            buttons.push([Markup.button.callback("✅ Tekshirish", "check_sub_2")]);
            try {
                await ctx.editMessageReplyMarkup({ inline_keyboard: buttons });
            } catch (err) {}
            await ctx.answerCbQuery("❌ Shartni to'liq bajaring", { show_alert: true });
        }
    } catch (e) { console.error("Sub 2 Action Error:", e); }
});

// 7. Admin Funksiyalari
bot.hears('📊 Statistika', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;

    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const totalUsers = await User.countDocuments();
    const active24h = await User.countDocuments({ lastActive: { $gte: last24h } });
    const blockedCount = await User.countDocuments({ status: 'blocked' });
    const channelsCount = await Channel.countDocuments();

    ctx.reply(`📊 *Bot statistikasi:*\n\n` +
        `👤 Jami foydalanuvchilar: ${totalUsers}\n` +
        `✅ Faol (24s): ${active24h}\n` +
        `🚫 Bloklaganlar: ${blockedCount}\n` +
        `📢 Ulangan kanallar: ${channelsCount}`, { parse_mode: 'Markdown' });
});

bot.hears('➕ Kanal qo\'shish', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    adminState[ctx.from.id] = { step: 'add_ch_id' };
    ctx.reply("Kanal ID raqamini yuboring (-100...):");
});

bot.hears('🗑 Kanallarni boshqarish', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const channels = await Channel.find();
    if (channels.length === 0) return ctx.reply("Hech qanday kanal ulanmagan.");

    for (const ch of channels) {
        ctx.reply(`Nomi: ${ch.name}\nID: ${ch.channelId}\nLink: ${ch.link}`,
            Markup.inlineKeyboard([[Markup.button.callback("❌ O'chirish", `del_${ch._id}`)]]));
    }
});

bot.action(/^del_(.+)$/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    await Channel.findByIdAndDelete(ctx.match[1]);
    ctx.answerCbQuery("O'chirildi!");
    ctx.editMessageText("🗑 Kanal o'chirildi.");
});

bot.hears('🔗 Majburiy Link', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const settings = await Config.findOne({ key: 'settings' });
    const currentLink = settings && settings.mandatoryLink ? settings.mandatoryLink : "O'rnatilmagan";

    adminState[ctx.from.id] = { step: 'set_mandatory_link' };
    ctx.reply(`Hozirgi majburiy link: ${currentLink}\n\nYangi linkni yuboring:`);
});

bot.hears('➕ Majbur-2 qo\'shish', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    adminState[ctx.from.id] = { step: 'add_ch2_id' };
    ctx.reply("Majbur-2 kanali ID raqamini yuboring (-100...):");
});

bot.hears('🗑 Majbur-2 boshqarish', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const channels2 = await Channel2.find();
    if (channels2.length === 0) return ctx.reply("Hech qanday Majbur-2 kanali ulanmagan.");

    for (const ch of channels2) {
        ctx.reply(`Majbur-2: ${ch.name}\nID: ${ch.channelId}\nLink: ${ch.link}`,
            Markup.inlineKeyboard([[Markup.button.callback("❌ O'chirish", `del2_${ch._id}`)]]));
    }
});

bot.action(/^del2_(.+)$/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    await Channel2.findByIdAndDelete(ctx.match[1]);
    ctx.answerCbQuery("O'chirildi!");
    ctx.editMessageText("🗑 Majbur-2 kanali o'chirildi.");
});

bot.hears('📢 Xabar yuborish', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    ctx.reply("Xabar yuborish turini tanlang:", Markup.inlineKeyboard([
        [Markup.button.callback("📝 Oddiy xabar", "msg_simple")],
        [Markup.button.callback("🔄 Forward (Uzatish)", "msg_forward")]
    ]));
});

bot.action('msg_simple', ctx => {
    adminState[ctx.from.id] = { step: 'ad_content' };
    ctx.reply("Reklama xabarini yuboring (matn, rasm, video...):");
});

bot.action('msg_forward', ctx => {
    adminState[ctx.from.id] = { step: 'ad_forward' };
    ctx.reply("Uzatish (forward) uchun xabarni menga yuboring:");
});

// 8. Xabarlarni qayta ishlash
bot.on('message', async (ctx) => {
    const userId = ctx.from.id;
    const message = ctx.message;
    const text = message.text;

    // Admin holatlari
    if (userId === ADMIN_ID && adminState[userId]) {
        let state = adminState[userId];

        if (state.step === 'add_ch_id') {
            adminState[userId] = { step: 'add_ch_link', id: text };
            return ctx.reply("Kanal uchun link yuboring (https://t.me/...):");
        }
        if (state.step === 'add_ch_link') {
            adminState[userId] = { step: 'add_ch_name', id: state.id, link: text };
            return ctx.reply("Tugma uchun nom yuboring (masalan: Kanal 1):");
        }
        if (state.step === 'add_ch_name') {
            await Channel.create({ channelId: state.id, link: state.link, name: text });
            delete adminState[userId];
            return ctx.reply("✅ Kanal muvaffaqiyatli qo'shildi!");
        }

        if (state.step === 'set_mandatory_link') {
            await Config.findOneAndUpdate(
                { key: 'settings' },
                { mandatoryLink: text },
                { upsert: true, new: true }
            );
            delete adminState[userId];
            return ctx.reply("✅ Majburiy link yangilandi!");
        }

        // Majburiy 2 qo'shish
        if (state.step === 'add_ch2_id') {
            adminState[userId] = { step: 'add_ch2_link', id: text };
            return ctx.reply("Majbur-2 uchun link yuboring (https://t.me/...):");
        }
        if (state.step === 'add_ch2_link') {
            adminState[userId] = { step: 'add_ch2_name', id: state.id, link: text };
            return ctx.reply("Tugma uchun nom yuboring:");
        }
        if (state.step === 'add_ch2_name') {
            await Channel2.create({ channelId: state.id, link: state.link, name: text });
            delete adminState[userId];
            return ctx.reply("✅ Majbur-2 kanali muvaffaqiyatli qo'shildi!");
        }

        if (state.step === 'ad_content') {
            adminState[userId] = { step: 'ad_btn_ask', msg: message };
            return ctx.reply("Xabarga tugma qo'shilsinmi?", Markup.inlineKeyboard([
                [Markup.button.callback("✅ Ha", "btn_yes"), Markup.button.callback("❌ Yo'q", "btn_no")]
            ]));
        }

        if (state.step === 'ad_btn_data') {
            const parts = text.split('|');
            if (parts.length < 2) return ctx.reply("Format xato! Nomi | Link");
            broadcast(ctx, state.msg.message_id, false, Markup.inlineKeyboard([[Markup.button.url(parts[0].trim(), parts[1].trim())]]));
            delete adminState[userId];
            return;
        }

        if (state.step === 'ad_forward') {
            broadcast(ctx, message.message_id, true);
            delete adminState[userId];
            return;
        }
    }

    // Foydalanuvchi xabari
    if (text && !text.startsWith('/')) {
        const unsubbed1 = await getUnsubscribedChannels(ctx, 'channels');
        if (unsubbed1.length > 0) {
            const buttons = unsubbed1.map((l) => [Markup.button.url(l.name, l.link)]);
            buttons.push([Markup.button.callback("✅ Tekshirish", "check_sub")]);
            return ctx.reply("⚠️ Botdan foydalanish uchun kanallarga obuna bo'ling yoki so'rov yuboring:", Markup.inlineKeyboard(buttons));
        }

        // Agar matn faqat raqamlardan iborat bo'lsa (Kino kodi)
        if (/^\d+$/.test(text)) {
            // Endi Majbur-2 tekshiramiz
            const unsubbed2 = await getUnsubscribedChannels(ctx, 'channels2');
            if (unsubbed2.length > 0) {
                const buttons = unsubbed2.map((l) => [Markup.button.url(l.name, l.link)]);
                buttons.push([Markup.button.callback("✅ Tekshirish", "check_sub_2")]);
                return ctx.reply("⚠️ Iltimos, quyidagi kanallarimga ham obuna bo'ling!", Markup.inlineKeyboard(buttons));
            }

            const settings = await Config.findOne({ key: 'settings' });
            const link = settings ? settings.mandatoryLink : null;

            if (link) {
                ctx.reply(`✅ Kod qabul qilindi. Marhamat, quyidagi link orqali ko'rishingiz mumkin:\n\n${link}`);
            } else {
                ctx.reply("❌ Xatolik: Admin tomonidan link o'rnatilmagan.");
            }
        } else {
            ctx.reply("❌ Iltimos to'g'ri kodni kiriting (Faqat raqam yuboring).");
        }
    }
});

// 9. Reklama Funksiyasi
async function broadcast(ctx, msgId, isForward, kb = null) {
    const users = await User.find();
    const total = users.length;
    ctx.reply(`🚀 ${total} kishiga yuborish boshlandi...`);

    let count = 0;
    let blocked = 0;

    for (const u of users) {
        try {
            if (isForward) {
                await ctx.telegram.forwardMessage(u.userId, ctx.from.id, msgId);
            } else {
                await ctx.telegram.copyMessage(u.userId, ctx.from.id, msgId, kb);
            }
            count++;
            if (count % 25 === 0) await sleep(1000);
        } catch (e) {
            if (e.response && (e.response.error_code === 403 || e.response.error_code === 400)) {
                await User.updateOne({ userId: u.userId }, { status: 'blocked' });
                blocked++;
            }
        }
    }
    ctx.reply(`✅ Tugatildi!\n✅ Yetkazildi: ${count}\n❌ Bloklagan: ${blocked}`);
}

bot.action('btn_yes', ctx => {
    if (!adminState[ctx.from.id]) return;
    adminState[ctx.from.id].step = 'ad_btn_data';
    ctx.reply("Tugma formatini yuboring: `Nomi | Link`", { parse_mode: 'Markdown' });
});

bot.action('btn_no', ctx => {
    if (!adminState[ctx.from.id]) return;
    const state = adminState[ctx.from.id];
    broadcast(ctx, state.msg.message_id, false);
    delete adminState[ctx.from.id];
});

// 10. Global Xatolarni boshqarish
bot.catch((err) => {
    console.error("🔴 Global xato:", err.message);
});

// 11. Botni ishga tushirish
bot.launch()
    .then(() => console.log("🚀 Bot muvaffaqiyatli ishga tushdi!"))
    .catch((err) => console.error("❌ Bot ishga tushmadi:", err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
