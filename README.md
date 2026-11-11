# Laylo AI

O‘zbekcha shaxsiy Telegram yordamchisi. Matn bilan suhbatlashadi, ovozli xabarni tushunadi va ayol ovozida javob qaytaradi. Rejalarni yozadi, vaqtli vazifalarni eslatadi va kundalik hisobot yuboradi.

## Mahalliy ishga tushirish

1. Node.js 22+ va Opus enkoderli FFmpeg kerak. `ffmpeg -version` buyrug‘i terminalda ishlashi kerak.
2. `.env.example` asosida `.env` faylini yarating. Telegram bot tokeni, egasining raqamli Telegram foydalanuvchi ID’si va Free tarifdagi Gemini API kalitini kiriting. Laylo shu ID egasining shaxsiy chatiga javob beradi. Egasining ko‘rinadigan ismini `LAYLO_OWNER_NAME` orqali sozlang.
3. `npm start` ni ishga tushiring. Botga `/voice` yuborib ovozni tinglang. Keyin oddiy ovozli topshiriq yuborib javobni tekshiring. `GEMINI_VOICE=Kore` bilan ikkinchi ovozni solishtirish mumkin. Boshlang‘ich ovoz — Aoede.

Ikkala Gemini modeli bitta kalitdan foydalanadi. `/report` bugungi vazifalarni chiqaradi. Ovozli javob qisqa, uzun javobning davomi va manba havolalari matnda keladi. Hisobotning dastlabki vaqti Toshkent vaqti bilan 08:00. Bir bot tokeniga bitta Laylo jarayoni ishlating.

## Qoidalar va xotira

- `config/laylo-rules.md` asosiy ish qoidalarini beradi. Egasiga xos qo‘shimcha yo‘riqnoma uchun Git tashqarisidagi matn faylini `LAYLO_PRIVATE_RULES_FILE` orqali ulang.
- `/about` Layloning kimligi va sozlangan egasini aytadi.
- `/remember ma’lumot` yoki “eslab qol” degan ovozli topshiriq afzallikni saqlaydi. `/memory` yozuvlarni ko‘rsatadi, `/forget yozuv-raqami` bitta yozuvni o‘chiradi.
- Xotira qayta ishga tushirilganda saqlanib qolishi uchun `.laylo/state.json` doimiy diskda turishi kerak. Laylo saqlangan yozuvlardan Gemini suhbatida foydalanadi. Shaxsiy hujjatlar, kalit va parollarni botga yubormang.

## Google Sheets va qidiruv

- Google Sheet ulanmaganda bot vazifalar va so‘nggi suhbatlarni `.laylo/state.json` ichida saqlaydi. Sheet ulansa, yangi vazifalar va hisobotlar o‘sha jadvaldan ishlaydi.
- Google Sheets API’ni yoqing va jadvalni xizmat hisobi emailiga tahrirlash huquqi bilan ulashing. `Vazifalar` nomli varaqda A–E ustunlarini **Vazifa**, **Sana**, **Vaqt**, **Holat**, **ID** deb nomlang. Sana va vaqt ustunlarini matn formatida saqlang. `.env`da `GOOGLE_SHEET_ID` va repodan tashqarida saqlanadigan xizmat hisobi JSON fayliga `GOOGLE_SERVICE_ACCOUNT_FILE` yo‘lini ko‘rsating.
- Ixtiyoriy internet qidiruvi uchun Free tarifdagi Tavily kalitini sozlang. Laylo topilgan manbalarni xulosa qilib, URL’larini yuboradi. Gemini Live orqali Google Search ulanishi keyingi bosqich.

## Sinash va joylashtirish

`npm test` tashqi API’larning test javoblari bilan ovozli xabar, Telegram javobi va reja yuborish oqimini tekshiradi. Jonli sinovda haqiqiy kalitlar, bot tokeni va FFmpeg kerak.

Bu dastlabki versiya mahalliy Node.js jarayoni sifatida ishlaydi. Ovoz uchun FFmpeg ishlatiladi. Doimiy bulut muhiti hali tanlanmagan va sozlanmagan. Test uchun maxfiy yoki mijozlarning shaxsiy ma’lumotlarini ishlatmang. Kalitlar, tokenlar va ma’lumotlar fayli Git tarixiga kiritilmaydi.
