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
    isPremium: { type: Boolean, default: false },
    premiumExpiresAt: { type: Date, default: null },
    premiumType: { type: String, default: null }, // '1_day', '1_week', '1_month', 'vip'
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
    mandatoryLink: { type: String, default: '' },
    cardDetails: { type: String, default: '8600 0000 0000 0000 (Admin)' }
});
const Config = mongoose.model('Config', configSchema);

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = parseInt(process.env.ADMIN_ID);

let adminState = {};
let userState = {};

// Tariflar ro'yxati
const TARIFFS = {
    '1_day': { name: '1-kunlik', price: '7 000 so\'m', days: 1 },
    '1_week': { name: '1-haftalik', price: '15 000 so\'m', days: 7 },
    '1_month': { name: '1-oylik', price: '30 000 so\'m', days: 30 },
    'vip': { name: 'VIP (Cheksiz)', price: '45 000 so\'m', days: null }
};

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
                const requestDoc = await Request.findOne({ userId: userId, channelId: ch.channelId.toString() });
                if (!requestDoc) {
                    unsubscribed.push(ch);
                }
            }
        } catch (e) {
            const requestDoc = await Request.findOne({ userId: userId, channelId: ch.channelId.toString() });
            if (!requestDoc) {
                unsubscribed.push(ch);
            }
        }
    }
    return unsubscribed;
}

// Premium faolligini tekshirish
async function checkUserPremium(user) {
    if (!user || !user.isPremium) return false;
    if (user.premiumType === 'vip') return true;
    if (user.premiumExpiresAt && new Date(user.premiumExpiresAt) > new Date()) {
        return true;
    }
    // Premium muddati tugagan
    user.isPremium = false;
    user.premiumType = null;
    user.premiumExpiresAt = null;
    await user.save();
    return false;
}

// Tariflar klaviaturasini yaratish
function getTariffKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback("1-kunlik — 7 000 so'm", "tariff_1_day")],
        [Markup.button.callback("1-haftalik — 15 000 so'm", "tariff_1_week")],
        [Markup.button.callback("1-oylik — 30 000 so'm", "tariff_1_month")],
        [Markup.button.callback("👑 VIP (Cheksiz) — 45 000 so'm", "tariff_vip")]
    ]);
}

// 5. Start Buyrug'i
async function sendStart(ctx) {
    try {
        const userId = ctx.from.id;
        const userName = ctx.from.first_name || '';

        // Foydalanuvchini saqlash yoki yangilash
        let user = await User.findOneAndUpdate(
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
                ['💳 Karta raqami', '🔗 Majburiy Link'],
                ['➕ Majbur-2 qo\'shish', '🗑 Majbur-2 boshqarish']
            ]).resize());
        }

        const unsubbed = await getUnsubscribedChannels(ctx, 'channels');

        if (unsubbed.length > 0) {
            const buttons = unsubbed.map((l) => [Markup.button.url(l.name, l.link)]);
            buttons.push([Markup.button.callback("✅ Tekshirish", "check_sub")]);
            return ctx.reply("🔴 Botdan foydalanish uchun quyidagi kanallarga obuna bo'ling yoki so'rov yuboring:", Markup.inlineKeyboard(buttons));
        }

        const isPremium = await checkUserPremium(user);
        if (isPremium) {
            return ctx.reply(`👋 Xush kelibsiz ${userName}!\n✨ Premium obunangiz faol. Marhamat, kino kodini yuboring.`);
        } else {
            return ctx.reply(`👋 Xush kelibsiz ${userName}!\n\n🔒 Botdan kino olish uchun *Premium obuna* sotib olishingiz kerak.\n\nQuyidagi tariflardan birini tanlang:`, {
                parse_mode: 'Markdown',
                ...getTariffKeyboard()
            });
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
            const userId = ctx.from.id;
            let user = await User.findOne({ userId });
            const isPremium = await checkUserPremium(user);

            if (isPremium) {
                await ctx.editMessageText("✅ Obuna tasdiqlandi! Premium obunangiz faol. Marhamat, kino kodini yuboring.");
            } else {
                await ctx.editMessageText("✅ Kanallarga obuna tasdiqlandi!\n\n🔒 Endi kino kodini yuborish va kinolarni ko'rish uchun *Premium obuna* tanlang:", {
                    parse_mode: 'Markdown',
                    ...getTariffKeyboard()
                });
            }
        } else {
            const buttons = unsubbed.map((l) => [Markup.button.url(l.name, l.link)]);
            buttons.push([Markup.button.callback("✅ Tekshirish", "check_sub")]);
            
            try {
                await ctx.editMessageReplyMarkup({ inline_keyboard: buttons });
            } catch (err) {}
            await ctx.answerCbQuery("❌ Shartni to'liq bajaring", { show_alert: true });
        }
    } catch (e) { console.error("Action error:", e); }
});

// Tarif tanlanganda
bot.action(/^tariff_(.+)$/, async (ctx) => {
    try {
        const tariffKey = ctx.match[1];
        const tariff = TARIFFS[tariffKey];
        if (!tariff) return ctx.answerCbQuery("Xatolik: Tarif topilmadi.");

        userState[ctx.from.id] = { step: 'selected_tariff', tariff: tariffKey };

        const settings = await Config.findOne({ key: 'settings' });
        const cardDetails = settings && settings.cardDetails ? settings.cardDetails : '8600 0000 0000 0000 (Admin)';

        const text = `💳 *To'lov ma'lumotlari*\n\n` +
            `📦 *Tanlangan tarif:* ${tariff.name}\n` +
            `💵 *To'lov summasi:* ${tariff.price}\n\n` +
            `💳 *Karta raqami:* \`${cardDetails}\`\n\n` +
            `⚠️ To'lovni amalga oshirgach, pastdagi *"💳 Chek yuborish"* tugmasini bosing va chek (rasm) yuboring!`;

        await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback("💳 Chek yuborish", `send_receipt_${tariffKey}`)],
                [Markup.button.callback("⬅️ Orqaga", "back_to_tariffs")]
            ])
        });
    } catch (e) { console.error("Tariff action error:", e); }
});

bot.action('back_to_tariffs', async (ctx) => {
    try {
        delete userState[ctx.from.id];
        await ctx.editMessageText("🔒 *Premium obuna* tariflaridan birini tanlang:", {
            parse_mode: 'Markdown',
            ...getTariffKeyboard()
        });
    } catch (e) { console.error("Back to tariffs error:", e); }
});

bot.action(/^send_receipt_(.+)$/, async (ctx) => {
    try {
        const tariffKey = ctx.match[1];
        userState[ctx.from.id] = { step: 'awaiting_receipt', tariff: tariffKey };
        await ctx.reply("📸 Iltimos, to'lov cheki rasmini (veya skrinshotini) yuboring:");
        await ctx.answerCbQuery();
    } catch (e) { console.error("Send receipt error:", e); }
});

// 7. Admin Funksiyalari
bot.hears('📊 Statistika', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;

    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const totalUsers = await User.countDocuments();
    const active24h = await User.countDocuments({ lastActive: { $gte: last24h } });
    const premiumUsers = await User.countDocuments({ isPremium: true });
    const blockedCount = await User.countDocuments({ status: 'blocked' });
    const channelsCount = await Channel.countDocuments();

    ctx.reply(`📊 *Bot statistikasi:*\n\n` +
        `👤 Jami foydalanuvchilar: ${totalUsers}\n` +
        `👑 Premium foydalanuvchilar: ${premiumUsers}\n` +
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

bot.hears('💳 Karta raqami', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const settings = await Config.findOne({ key: 'settings' });
    const card = settings && settings.cardDetails ? settings.cardDetails : "8600 0000 0000 0000 (Admin)";

    adminState[ctx.from.id] = { step: 'set_card_details' };
    ctx.reply(`Hozirgi karta raqami: ${card}\n\nYangi karta raqami va ma'lumotlarini yuboring:`);
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

// Admin To'lovni tasdiqlash callback lari
bot.action(/^approve_(\d+)_(.+)$/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;

    try {
        const targetUserId = parseInt(ctx.match[1]);
        const tariffKey = ctx.match[2];
        const tariff = TARIFFS[tariffKey];

        if (!tariff) return ctx.answerCbQuery("Xato: Tarif topilmadi");

        let expiresAt = null;
        if (tariff.days) {
            expiresAt = new Date(Date.now() + tariff.days * 24 * 60 * 60 * 1000);
        }

        await User.findOneAndUpdate(
            { userId: targetUserId },
            {
                isPremium: true,
                premiumType: tariffKey,
                premiumExpiresAt: expiresAt
            }
        );

        await ctx.answerCbQuery("✅ Obuna faollashtirildi!");

        const origCaption = ctx.callbackQuery.message.caption || ctx.callbackQuery.message.text || '';
        await ctx.editMessageCaption(origCaption + `\n\n✅ *TO'LOV TASDIQLANDI! Obuna faollashtirildi.*`, { parse_mode: 'Markdown' });

        try {
            await ctx.telegram.sendMessage(targetUserId, `🎉 *Sizning to'lovingiz tasdiqlandi!*\n\n✨ **${tariff.name}** Premium obunangiz faollashtirildi. Endi kinolarni kodingiz orqali tomosha qilishingiz mumkin!\n\nMarhamat, kino kodini yuboring:`, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error("Foydalanuvchiga tasdiqlash xabari yuborishda xato:", err.message);
        }
    } catch (e) {
        console.error("Approve action error:", e);
    }
});

bot.action(/^reject_(\d+)$/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;

    try {
        const targetUserId = parseInt(ctx.match[1]);
        await ctx.answerCbQuery("❌ Rad etildi.");

        const origCaption = ctx.callbackQuery.message.caption || ctx.callbackQuery.message.text || '';
        await ctx.editMessageCaption(origCaption + `\n\n❌ *TO'LOV RAD ETILDI.*`, { parse_mode: 'Markdown' });

        try {
            await ctx.telegram.sendMessage(targetUserId, `❌ *Siz yuborgan to'lov cheki rad etildi.*\n\nQayta to'lov qilib chek yuborishingiz yoki adminga murojaat qilishingiz mumkin.`, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error("Foydalanuvchiga rad xabari yuborishda xato:", err.message);
        }
    } catch (e) {
        console.error("Reject action error:", e);
    }
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

        if (state.step === 'set_card_details') {
            await Config.findOneAndUpdate(
                { key: 'settings' },
                { cardDetails: text },
                { upsert: true, new: true }
            );
            delete adminState[userId];
            return ctx.reply("✅ Karta raqami va ma'lumotlari yangilandi!");
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

    // Foydalanuvchi chek yuborishi
    if (userState[userId] && userState[userId].step === 'awaiting_receipt') {
        const isPhoto = message.photo && message.photo.length > 0;
        const isDocument = message.document && message.document.mime_type && message.document.mime_type.startsWith('image/');

        if (isPhoto || isDocument) {
            const tariffKey = userState[userId].tariff;
            const tariff = TARIFFS[tariffKey] || { name: "Noma'lum", price: '-' };

            const uName = ctx.from.first_name || '';
            const uUsername = ctx.from.username ? `@${ctx.from.username}` : "Mavjud emas";
            const uId = ctx.from.id;

            const caption = `📥 *YANGI TO'LOV CHEKI!*\n\n` +
                `👤 *Foydalanuvchi:* ${uName}\n` +
                `🆔 *ID:* \`${uId}\`\n` +
                `🏷 *Username:* ${uUsername}\n` +
                `📦 *Tanlangan tarif:* ${tariff.name}\n` +
                `💵 *Summa:* ${tariff.price}`;

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback("✅ Tasdiqlash", `approve_${uId}_${tariffKey}`),
                    Markup.button.callback("❌ Rad etish", `reject_${uId}`)
                ]
            ]);

            try {
                if (isPhoto) {
                    const fileId = message.photo[message.photo.length - 1].file_id;
                    await ctx.telegram.sendPhoto(ADMIN_ID, fileId, { caption, parse_mode: 'Markdown', ...keyboard });
                } else {
                    const fileId = message.document.file_id;
                    await ctx.telegram.sendDocument(ADMIN_ID, fileId, { caption, parse_mode: 'Markdown', ...keyboard });
                }

                delete userState[userId];
                return ctx.reply("✅ Chekingiz adminga yuborildi! Admin tekshirib obunani faollashtirgach sizga bildirishnoma boradi.");
            } catch (err) {
                console.error("Adminga chek yuborishda xato:", err);
                return ctx.reply("❌ Chekni adminga yuborishda xatolik yuz berdi. Iltimos qaytadan urinib ko'ring.");
            }
        } else {
            return ctx.reply("⚠️ Iltimos, to'lov chekining rasmini yuboring!");
        }
    }

    // Foydalanuvchi xabari / Kod yuborishi
    if (text && !text.startsWith('/')) {
        const unsubbed1 = await getUnsubscribedChannels(ctx, 'channels');
        if (unsubbed1.length > 0) {
            const buttons = unsubbed1.map((l) => [Markup.button.url(l.name, l.link)]);
            buttons.push([Markup.button.callback("✅ Tekshirish", "check_sub")]);
            return ctx.reply("⚠️ Botdan foydalanish uchun kanallarga obuna bo'ling yoki so'rov yuboring:", Markup.inlineKeyboard(buttons));
        }

        // Agar matn faqat raqamlardan iborat bo'lsa (Kino kodi)
        if (/^\d+$/.test(text)) {
            let user = await User.findOne({ userId });
            const isPremium = await checkUserPremium(user);

            if (!isPremium) {
                return ctx.reply("🔒 *Kinolarni ko'rish uchun Premium obuna zarur!*\n\nIltimos, quyidagi tariflardan birini tanlang va to'lov qiling:", {
                    parse_mode: 'Markdown',
                    ...getTariffKeyboard()
                });
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
