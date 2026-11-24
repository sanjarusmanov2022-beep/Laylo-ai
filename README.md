# Laylo so‘rovnoma boti

Telegram orqali xodimlar va rahbarlar fikrini yig‘adi. Xodimlar uchun 57 ta, rahbarlar uchun 40 ta savol bor.

## Ishtirokchi

/start har safar avval yozuvni tanlash tugmalarini ochadi: **Lotincha** yoki **Кириллча**. Tanlov saqlanadi; savollar, variantlar va tugmalar shu yozuvda ko‘rinadi. Menyu va savollardagi **🔤 Lotin / Кирилл** tugmasi yoki `/script` orqali yozuvni almashtirish mumkin; savol va tanlangan javoblar saqlanadi. Bevosita so‘rovnoma havolasida ham avval yozuv so‘raladi, keyin aynan o‘sha so‘rovnoma davom etadi. Kirilcha `3,5 млн сўм` summasi ham qabul qilinadi. Yozma javoblar asl holida, tanlovlar esa umumiy bir xil variantlar bilan saqlanadi.

Yozuv tanlangach rol tanlash tugmalari ochiladi. Ko‘p tanlovli savolda mos variantlar bittadan belgilanadi: belgi va tanlanganlar soni ko‘rinadi, so‘ng **Davom etish** bosiladi. Imtiyozlar savolida 3–4 ta yoki barcha variantni tanlash mumkin; «eng muhim 3 ta» deb so‘ralgan savollarda 3 ta cheklovi saqlanadi.

Variantli savollar tugma bilan, boshqa savollar matn yoki raqam bilan javoblanadi. Ism va yosh avval alohida savollar bilan so‘raladi; ikkalasiga javob berish ham ixtiyoriy. Yosh 1–120 oralig‘ida butun son sifatida tekshiriladi va CSV fayliga alohida ustunda yoziladi. Har bir javob saqlanadi. Orqaga qaytish, o‘tkazib yuborish va /survey orqali davom etish mumkin.

## Egasi

/admin menyusida qatnashuvchilar, savollar bo‘yicha son va foizlar, CSV eksport, havolalar, ochish-yopish va yangi so‘rovnoma yaratish tugmalari bor. Yangi savol uchun oddiy matn yuboring. Variantli savol shakli `Tushlik beriladimi? | Ha | Yo‘q`.

Admin menyusidagi **🧪 Mijoz rejimi** xodim va rahbar savollarini egasiga sinash imkonini beradi. Sinov jarayoni va javoblari alohida saqlanadi: ishtirokchilar soni, hisobot, CSV va yakunlanganlik bildirishnomalariga qo‘shilmaydi. Har bir savolda rolni tanlash, boshidan boshlash va admin menyusiga qaytish tugmalari bor. `/admin` yoki `/start` sinov rejimidan chiqaradi. Yopiq so‘rovnomalarni ham egasi sinashi mumkin.

Hisobot foizlari savolga javob bergan va so‘rovnomani yakunlaganlar sonidan olinadi. Ko‘p tanlovli foizlar 100 dan oshishi mumkin. CSV faylida tugallanmagan javoblar belgilangan. Yozma javoblar asl holida saqlanadi. Pul summalari valyuta bo‘yicha hisoblanadi. `3,5 mln` kabi javobda valyuta ko‘rsatilmasa, UZS olinadi.

## Hisobotlar kanali yoki guruhi

Admin menyusidagi **📨 Hisobotlar kanali** → **Kanalni ulash** orqali @username, t.me havolasi yoki yopiq kanaldan forward qilingan xabarni yuboring. Egasi ham, Laylo ham shu kanalda administrator bo‘lishi, Layloda xabar joylash huquqi bo‘lishi kerak. Faqat egasi ulanishni o‘zgartira oladi. `/reportchannel @username` ham ishlaydi. Kanal ulanmaguncha odatiy admin hisobotlari va CSV ishlashda davom etadi.

Ulangandan keyin har bir yakunlangan yangi so‘rovnoma kanalga qisqa ma’lumot (ixtiyoriy ism va yosh, so‘rovnoma, sana, javob raqami) va barcha savol-javoblar CSV fayli bilan yuboriladi. Telegram ID faylga qo‘shilmaydi. Qatnashuvchiga yakunda ochiq hisobotlar kanalining @username, t.me havolasi va kanalni ochish tugmasi ko‘rsatiladi. Sinov rejimidagi javoblar yuborilmaydi. Yakunlanmagan javoblar asosiy bazada saqlanadi, kanalga yuborilmaydi. Kanalning o‘z ruxsatlari undagi hisobotlarni kim ko‘rishini belgilaydi.

Yuboriladigan hisobot tugallangan javob bilan birga atomik saqlanadi. Vaqtinchalik xatoda navbat saqlanadi; Cloudflare Durable Object alarm orqali qayta urinadi. Admin menyusidan ham qayta yuborishga urinish mumkin. Ulanish o‘chirilsa, navbat kutadi; keyin ulangan kanalga yuboriladi. Telegramdan muvaffaqiyatli javob olingan hisobot qayta tugma bosilganda takrorlanmaydi.

## Bepul Cloudflare va GitHub

Cloudflare Workers Free va SQLite-backed Durable Objects ishlatiladi. Javoblar Durable Object ichida saqlanadi. GitHub’da kod va savollar joylashadi. Bot tokeni va javoblar GitHub’ga kiritilmaydi.

Jonli Worker `laylo-surveys` Cloudflare’ga bevosita joylandi. Keyingi yangilanishlar terminaldan `node --env-file=.env scripts/deploy-surveys.mjs` orqali qilinadi. Ruxsat kaliti `.laylo/cloudflare-surveys.json` ichida maxfiy saqlanadi. GitHub’ga push qilish o‘z-o‘zidan hostingni yangilamaydi.

Jonli xizmat https://laylo-surveys.sanjar-usmanov-2023.workers.dev/health orqali tekshiriladi. Telegram bot https://t.me/Laylo_asistent_bot .

Worker secrets sifatida quyidagilarni sozlang.

- TELEGRAM_BOT_TOKEN
- TELEGRAM_OWNER_ID
- TELEGRAM_BOT_USERNAME
- TELEGRAM_WEBHOOK_SECRET

Webhook secret kamida 32 ta tasodifiy harf, raqam, tire yoki pastki chiziqdan iborat bo‘lsin. `/health` xizmat holatini ko‘rsatadi. Deploydan keyin bir xil secret bilan quyidagini ishga tushiring.

`node --env-file=.env scripts/connect-survey-webhook.mjs https://WORKER.workers.dev/telegram`

Bu webhook va Telegram buyruqlar menyusini ulaydi. Bir bot tokeniga bitta faol qabul qiluvchi ishlaydi.

Free tarifning kunlik chegaralari bor. Worker va Durable Object so‘rovlari kuniga 100 000 tagacha, SQLite yozuvlari 100 000 tagacha, umumiy saqlash 5 GB. Shu hisobdagi boshqa ilovalarning sarfi ham hisoblanadi. Limitga yetganda amallar vaqtincha ishlamaydi.

- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/workers/ci-cd/builds/

## Tekshirish

Node.js 22.12+ kerak. `node --test test/surveys.test.mjs` ikki rol, admin ruxsatlari, takroriy bosish, qayta ishga tushgach davom etish, hisobot va CSV’ni tekshiradi. `LAYLO_TEST_PARTICIPANTS=1000` sun'iy ishtirokchilar sonini oshiradi. Bu haqiqiy bir vaqtdagi yuk sinovi hisoblanmaydi.

Mahalliy polling uchun `.env.example` asosida sozlang va `npm start` bajaring. Doimiy ishlash uchun Cloudflare ulanishini tugating.
