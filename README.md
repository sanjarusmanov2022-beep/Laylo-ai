# Laylo so‘rovnoma boti

Telegram orqali xodimlar va rahbarlar fikrini yig‘adi. Xodimlar uchun 84 ta, rahbarlar uchun 67 ta savol bor. Dastlabki 57 va 40 savol saqlangan; har ikki yo‘nalishga 16 ta vaziyatli savol, 4 ta tajriba/taklif savoli va 4 ta qarorlarni aniqlashtiruvchi savol hamda 3 ta batafsil KPI savoli qo‘shilgan.

## Ishtirokchi

/start har safar avval yozuvni tanlash tugmalarini ochadi: **Lotincha** yoki **Кириллча**. Tanlov saqlanadi; savollar, variantlar va tugmalar shu yozuvda ko‘rinadi. Menyu va savollardagi **🔤 Lotin / Кирилл** tugmasi yoki `/script` orqali yozuvni almashtirish mumkin; savol va tanlangan javoblar saqlanadi. Bevosita so‘rovnoma havolasida ham avval yozuv so‘raladi, keyin aynan o‘sha so‘rovnoma davom etadi. Kirilcha `3,5 млн сўм` summasi ham qabul qilinadi. Yozma javoblar asl holida, tanlovlar esa umumiy bir xil variantlar bilan saqlanadi.

Yozuv tanlangach rol tanlash tugmalari ochiladi. Ko‘p tanlovli savolda mos variantlar bittadan belgilanadi: belgi va tanlanganlar soni ko‘rinadi, so‘ng **Davom etish** bosiladi. Imtiyozlar savolida 3–4 ta yoki barcha variantni tanlash mumkin; «eng muhim 3 ta» deb so‘ralgan savollarda 3 ta cheklovi saqlanadi.

Variantli savollar tugma bilan, boshqa savollar matn yoki raqam bilan javoblanadi. Avval hisobotda ko‘rinadigan ism/korxona nomi yoki foydalanuvchi tanlagan maxfiy raqam so‘raladi. Bu maydon majburiy; nomsiz va raqamsiz davom etilmaydi. Xodim o‘z ismini yoki raqamini, rahbar korxona nomini yoki raqamini kiritadi. Yosh alohida so‘raladi va ixtiyoriy. Yosh 1–120 oralig‘ida butun son sifatida tekshiriladi va CSV fayliga alohida ustunda yoziladi. Har bir javob saqlanadi. Orqaga qaytish, o‘tkazib yuborish va /survey orqali davom etish mumkin.

## Egasi

/admin menyusida qatnashuvchilar, savollar bo‘yicha son va foizlar, CSV eksport, havolalar, ochish-yopish va yangi so‘rovnoma yaratish tugmalari bor. Yangi savol uchun oddiy matn yuboring. Variantli savol shakli `Tushlik beriladimi? | Ha | Yo‘q`.

Admin menyusidagi **🧪 Mijoz rejimi** xodim va rahbar savollarini egasiga sinash imkonini beradi. Sinov jarayoni va javoblari alohida saqlanadi: ishtirokchilar soni, hisobot, CSV va yakunlanganlik bildirishnomalariga qo‘shilmaydi. Har bir savolda rolni tanlash, boshidan boshlash va admin menyusiga qaytish tugmalari bor. `/admin` yoki `/start` sinov rejimidan chiqaradi. Yopiq so‘rovnomalarni ham egasi sinashi mumkin.

Hisobot foizlari savolga javob bergan va so‘rovnomani yakunlaganlar sonidan olinadi. Ko‘p tanlovli foizlar 100 dan oshishi mumkin. CSV faylida tugallanmagan javoblar belgilangan. Yozma javoblar bazada asl holida saqlanadi. Kanal hisobotining matni va PDF fayli qatnashuvchi yakunlash paytida tanlagan lotin yoki kiril yozuvida chiqariladi; keyin yozuvni almashtirish navbatdagi tayyor hisobot yozuvini o‘zgartirmaydi. Pul summalari valyuta bo‘yicha hisoblanadi. `3,5 mln` kabi javobda valyuta ko‘rsatilmasa, UZS olinadi.

## Xulosa, baho va tavsiyalar

Har bir yakunlangan asosiy so‘rovnomaga korxona va xodim uchun alohida xulosa hamda tavsiyalar qo‘shiladi. Korxona sharoitlari va xodimning ish tajribasi 0–10 oralig‘idagi so‘rovnoma indekslari bilan ko‘rsatiladi. Baholar ism, yosh yoki mutlaq maosh summasiga bog‘liq emas. Qoidalar `src/survey-insights.mjs` ichida versiyalangan.

Kamida uchta tanilgan ko‘rsatkichga javob bo‘lishi kerak; kam bo‘lsa «Ma’lumot yetarli emas» chiqadi. O‘tkazilgan, noma’lum va erkin matndan aniq aniqlanmaydigan javoblar 0 sifatida hisoblanmaydi. Xodim so‘rovnomasida ish sharoiti uchun 12, ish tajribasi/qoniqishi uchun 7 ko‘rsatkich bor. Maoshni vaqtida to‘lash, qo‘shimcha ishni qoplash, dam olish va adolat ko‘rsatkichlari ikki vaznga, boshqalari bir vaznga ega. Rahbar so‘rovnomasida jarayonlar bo‘yicha 4 ko‘rsatkich bor; xodimning o‘z javobisiz uning qoniqishi baholanmaydi. Bular respondent javoblari asosidagi indekslar.

Kanalda avval status, foiz shkalalari va qisqa tavsiyalar posti, keyin katta shriftli diagrammali PDF tahlil chiqadi. To‘liq xom savol-javoblar admin CSV eksportida saqlanadi. Fayl vaqtincha yuborilmasa, yuborilgan xulosa qayta takrorlanmaydi. Sinov rejimi shu tahlilni egasining shaxsiy chatida ko‘rsatadi, kanalga yubormaydi.

## Vaziyatli savollar va shaxsiy tavsiyalar

`assessment` metama’lumotida har bir vaziyatli variantning 0–10 balli mezoni va unga mos tavsiyasi ochiq saqlanadi. Variantlar tartibi savollar orasida almashadi. Maoshni vaqtida so‘rash, shartlarni aniqlashtirish va xavfli/charchoqdagi ishni mas’ulga xabar qilib to‘xtatish past ball sababi emas. Har savolda «Vaziyatga bog‘liq / aniq javobim yo‘q» hamda erkin matn bilan javob berish imkoniyati bor; ular sonli ballga majburan aylantirilmaydi.

Beshta yo‘nalish: ochiq muloqot, mas’uliyat va adolat, bosimda ishni tashkil qilish, hamkorlik, o‘rganish/tashabbus. Har yo‘nalishda kamida 2 ta baholanadigan javob kerak. Umumiy vaziyatli indeks uchun kamida 8 ta javob va kamida 3 ta yetarli yo‘nalish kerak. Har bir baholangan vaziyat bir xil vaznga ega. Profil tanlangan variantlarga bog‘liq kuzatuvlarni savol raqami bilan ko‘rsatadi. Bir xil umumiy ball bo‘lsa ham yo‘nalishlar, kuzatuv va tavsiyalar farq qilishi mumkin.

Odam yozgan tajriba, korxonani yaxshilash, bonus/imtiyoz modeli va rivojlanish takliflari hisobotda uning o‘z so‘zlaridan qisqa iqtibos sifatida chiqadi; to‘liq matn CSV faylida saqlanadi. Tavsiyalar javoblarga bog‘liq aniq qoidalar orqali tuziladi; bir xil javoblarga o‘xshash tavsiyalar chiqishi mumkin. Pullik AI yoki qo‘shimcha server talab qilinmaydi.

Bu mustaqil tuzilgan rivojlanish so‘rovnomasi. Vaziyatli shakl ishdagi holat va javob variantlariga tayanadi; savollar va ballar psixometrik validatsiyadan o‘tkazilgan ishga olish testi yoki klinik baholash sifatida taqdim etilmaydi. Natija xodim/rahbar bilan suhbat, amaliy misollar va rivojlanish rejasiga yordam beradi. Shakl bo‘yicha asosiy manba: https://www.opm.gov/policy-data-oversight/assessment-and-selection/other-assessment-methods/situational-judgment-tests/

Eski yakunlangan javoblar o‘z savol soni bilan qoladi; ularga yangi savollar o‘tkazilgan deb yozilmaydi. Eski tugallanmagan jarayonlar oldingi javoblarini saqlab davom etadi. Eski yakunlash oynasi ochiq qolgan bo‘lsa ham yangi savollar tugamasdan yuborish amalga oshmaydi. Uzun kanal hisobotlari 3500 belgigacha bo‘laklanadi; keyingi bo‘lakda xato bo‘lsa, yuborilganlari qaytarilmasdan davom ettiriladi.

## Qoniqish va amaliy qaror yo‘nalishlari

Xodimdan o‘z ko‘nikmalaridan foydalanish, aniq muqobil taklif, muammoni hal qilishga urinish va umumiy qoniqish alohida so‘raladi. Qoniqishning bevosita javobi alohida ko‘rsatiladi: juda qoniqish 10, asosan qoniqish 8, aralash/o‘rtacha 5, asosan norozilik 2, juda norozilik 0. Noma’lum yoki erkin matn taxmin bilan sonli bahoga aylantirilmaydi. Ish sharoitlari yuqori baholansa ham, respondentning noroziligi yashirilmaydi yoki rozi deb almashtirilmaydi.

Qaror bo‘yicha yo‘nalishlar: hozirgi ishda qolib rivojlanish, ko‘nikmaga mos vazifa so‘rash, yetishmayotgan ko‘nikmani oshirish, sharoitlarni aniq kelishish yoki muqobil takliflarni solishtirish. Boshqa ishlarni jiddiy solishtirish tavsiyasi uchun bildirgan norozilik, bir nechta noqulay sharoit va natija bermagan muhokamalar birga olinadi. Mavjud bo‘lmagan mehnat bozori ma’lumoti yoki tekshirilmagan bilim darajasi haqida da’vo qilinmaydi. Yakuniy qaror respondentning o‘z sharoiti va aniq takliflarni tekshirishiga bog‘liq.

Rahbar uchun KPI maqsadi, natijaga xodimning ta’siri, bonus byudjeti va hisobni qayta tekshirish tartibi so‘raladi. Tavsiyalar tanlangan ish natijasiga mos mezon beradi: muddat, xato ulushi, xizmat sifati, savdo, samaradorlik yoki jamoani rivojlantirish. Tayyor bonus summasi yoki isbotlanmagan maqsad o‘ylab topilmaydi; mezon, ma’lumot manbasi va imkoniyatni oldindan kelishish tavsiya qilinadi.

## KPI holati va xodimni rag‘batlantirish

Rahbardan amaldagi KPI turlari, lavozimga mezon qo‘yish asoslari va bitta haqiqiy hisoblash misoli so‘raladi: lavozim → ko‘rsatkich → maqsad → hisob davri → ma’lumot manbasi → bonus sharti. Avvalgi kelajakdagi maqsadlar savoli amaldagi tizimdan alohida saqlanadi.

Xodimdan hozirgi KPI holati, qaysi natijaga bog‘langan rag‘bat uni kuchliroq ishlashga undashi va kerakli shartlar so‘raladi. Mavjud bonus taklifi savolida uning miqdor va hisoblash taklifi ham yoziladi. Bir nechta KPI mezoni/sharti tanlanadi; «KPI hali yo‘q» varianti boshqa amaldagi variantlar bilan birga tanlanmaydi.

Hisobotda aynan tanlangan KPI javoblari, rahbarning misoli va ularga mos amaliy tavsiyalar ko‘rsatiladi. KPI afzalliklari bahoga ta’sir qilmaydi; bonus foizi yoki maqsad taxmin bilan o‘ylab topilmaydi.

## Nom yoki maxfiy raqam

`789-456-85` kabi foydalanuvchi tanlagan raqam kanal sarlavhasida «789-456-85 raqami hisoboti» deb ko‘rsatiladi. Raqam tanlansa, Telegramdagi ism olinmaydi va kanalda berilmaydi. Oddiy so‘rovnomada bir xil raqam (bo‘shliq va tire hisobga olinmasdan) bir rol ichida ikki kishiga band qilinmaydi; sinov rejimi haqiqiy raqamlarni band qilmaydi. Eski tugallanmagan nomsiz jarayonlar oldingi javoblarini saqlagan holda majburiy belgi kiritishga yo‘naltiriladi. Maxfiy qolishi kerak bo‘lgan ismlarni erkin matnli javoblarga ham kiritmaslik kirish qismida tushuntiriladi.

## Ishxona nomi va sektor

Xodimning shaxsiy nomi/maxfiy raqamidan tashqari uning ishxonasi nomi alohida so‘raladi. Ism yoki raqamdan keyin yosh, keyin ishxona nomi yoki **Ishxonam nomi sir qolsin**, so‘ng sektor tanlanadi. Nomni oshkor qilish ixtiyoriy. Nom kiritilgandan keyin maxfiylik tanlansa, u sessiyadan o‘chadi va kanal hisobotida ham, CSVda ham «Sir saqlangan» chiqadi. Rahbar korxona nomi yoki raqamini avval kiritgani uchun ikkinchi marta so‘ralmaydi.

Sektor ikkala yo‘nalishda ham so‘raladi: davlat, xususiy, davlat-xususiy/aralash, nodavlat notijorat, boshqa/aniq bilmayman yoki ko‘rsatishni istamayman. Ishxona va sektor ma’lumoti kanal sarlavhasi tafsilotlari hamda CSVning alohida ustunlarida beriladi. Ular baholash balliga ta’sir qilmaydi. Ushbu tanishtiruv savollari asosiy 84/67 savoldan oldin keladi.

Eski tugallanmagan jarayonlar avvalgi javoblarini saqlab, yetishmayotgan ishxona/sektor savollaridan keyin o‘sha joydan davom etadi. Eski yakunlangan javoblar qayta ochilmaydi.

## Hisobotlar kanali yoki guruhi

Admin menyusidagi **📨 Hisobotlar kanali** → **Kanalni ulash** orqali @username, t.me havolasi yoki yopiq kanaldan forward qilingan xabarni yuboring. Egasi ham, Laylo ham shu kanalda administrator bo‘lishi, Layloda xabar joylash huquqi bo‘lishi kerak. Faqat egasi ulanishni o‘zgartira oladi. `/reportchannel @username` ham ishlaydi. Kanal ulanmaguncha odatiy admin hisobotlari va CSV ishlashda davom etadi.

Ulangandan keyin har bir yakunlangan yangi so‘rovnoma kanalga qisqa tahlil va diagrammali PDF fayli bilan yuboriladi. Telegram ID faylga qo‘shilmaydi. Qatnashuvchiga yakunda ochiq hisobotlar kanalining @username, t.me havolasi va kanalni ochish tugmasi ko‘rsatiladi. Sinov rejimidagi javoblar yuborilmaydi. Yakunlanmagan javoblar asosiy bazada saqlanadi, kanalga yuborilmaydi. Kanalning o‘z ruxsatlari undagi hisobotlarni kim ko‘rishini belgilaydi.

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

## Holat va yetkazish bo‘yicha tekshirilgan chekka holatlar

Tanaffusdan keyin alohida **Davom ettirish** tugmasi bor; tanaffusdagi oddiy matn javob sifatida yutilmaydi. Sinov rejimining qaytish tugmasi admin menyusiga chiqilgandan keyin ham faqat sinovga qaytaradi. Yozuv tanlash oynasida kiritilgan matn savol javobiga aylanmaydi; `/survey` yoki `/cancel` bilan yozuv tanlashni bekor qilish mumkin.

Qo‘shimcha ish umuman bo‘lmasa, unga haq to‘lash haqidagi javob bahoni pasaytirmaydi. Tahlilning bu qoidalari `laylo-survey-indicators-v4` bilan belgilangan. Uzun iqtiboslardagi emoji belgilar Unicode bo‘yicha buzilmaydi.

Kanal o‘zgartirilsa, oldingi kanalda qisman yuborilgan hisobot yangi kanalda boshidan to‘liq yuboriladi. Hisobot navbati 100 yozuvli sahifalar orqali ko‘riladi; barchasi birdan xotiraga yig‘ilmaydi. Navbatdagi ishlar oddiy savol tugmalariga javob berishni to‘sib turmaydi; alarm va alohida qayta yuborish yo‘li orqali ishlanadi.

## Tekshirish

Node.js 22.12+ kerak. `node --test test/surveys.test.mjs` ikki rol, admin ruxsatlari, takroriy bosish, qayta ishga tushgach davom etish, hisobot va CSV’ni tekshiradi. `LAYLO_TEST_PARTICIPANTS=1000` sun'iy ishtirokchilar sonini oshiradi. Bu haqiqiy bir vaqtdagi yuk sinovi hisoblanmaydi.

Mahalliy polling uchun `.env.example` asosida sozlang va `npm start` bajaring. Doimiy ishlash uchun Cloudflare ulanishini tugating.


## PDF va yangi kanal posti

PDF yaratish to‘liq Worker ichida amalga oshadi: pullik API, brauzer yoki alohida server kerak emas. Noto Sans asosidagi ochiq litsenziyali shrift lotin va kiril harflarini qamrab oladi; shriftlar PDFga joylanadi. Shriftlarning siqilgan moduli scripts/build-pdf-fonts.py bilan tayyorlangan; runtime Python kutubxonasini ishlatmaydi. SIL OFL litsenziyasi assets/NotoSans-OFL.txt da.

Kanal posti HTML bilan qalin sarlavha, emoji va 10 qismli foiz shkalalarini ko‘rsatadi. Har ikkala fayl/postda hisobot IDsi saqlanadi. Ochiq kanal username bo‘lsa, obuna bo‘lish matni, havola va tugma qo‘shiladi; PDFning oxirgi sahifasi va pastki qismida ham bosiladigan kanal havolasi bor. Oddiy matnning Telegram shrift o‘lchami o‘zgartirilmaydi, katta shrift PDFda ishlatiladi.

Foiz = 10 ballik indeks × 10; u ishga yaroqlilik ehtimoli yoki xodimlar ichidagi percentil emas. Status vaziyatli javoblarga asoslanadi: kamida 8 ta baholanadigan javob va yetarli yo‘nalishlar kerak. 9+ ball, kamida 75% qamrov va muloqot/adolat/hamkorlik yo‘nalishlari 8+ bo‘lsa «Yetakchilikka moyil yondashuv»; 8+ «Kuchli yondashuv»; 6+ «Barqaror yondashuv»; pastroq bo‘lsa «Rivojlantirish zarur». Dalil yetmasa status qo‘yilmaydi. Bu tasdiqlangan kasbiy malaka yoki klinik tashxis emas.

Admin menyusidagi PDF hisobotlar yoki /pdf saqlangan haqiqiy yakunlangan javoblarni ko‘rsatadi. /pdf HISOBOT_ID shu hisobotni egasiga yuboradi. PDFdan keyingi Kanalga qayta yuborish tugmasi yangi uslubdagi post va PDFni faqat ulangan kanalga qayta yuboradi. Hisobot qayta hisoblanadi, ammo ishtirokchi yoki javoblar soni oshmaydi. Sinovlar ro‘yxatga kirmaydi; ro‘yxat sahifalanadi.

Oddiy qatnashuvchi yakunda Hisobotni qayta yuborish tugmasini bosishi mumkin. Faqat o‘zining yakunlangan javobi kanalga qayta yuboriladi; shaxsiy chatiga PDF berilmaydi, kanal havolasi ko‘rsatiladi. Takroriy bosishlar 60 soniya ichida yangi post yaratmaydi. Kanalni ko‘rish uchun obuna bo‘lishni Telegram orqali majburiy tekshirish yo‘q.

Qayta yuborish vazifalari ham saqlanadigan navbatdan o‘tadi. Bir xil Telegram yangilanishi takrorlansa yangi nusxa yaratmaydi; muvaffaqiyatli yuborilgan post fayl xatosida takrorlanmaydi. Kanal almashtirilsa yangi kanal havolasi bilan post qayta tayyorlanadi.


Mijozning bosh menyusida ham Hisobotni qayta yuborish tugmasi bor. Bitta tugallangan haqiqiy javob bo‘lsa o‘sha hisobot kanalga qayta yuboriladi; ikki rol tugallangan bo‘lsa tanlash so‘raladi. Faqat shu mijozning javoblari olinadi. So‘rovnoma keyin yopilgan bo‘lsa ham eski tugallangan hisobotni olish mumkin. Hali tugallanmagan bo‘lsa, avval yakunlash tushuntiriladi. Sinov menyusida shu tugma sinovlar kanalga chiqmasligini tushuntiradi va egaga haqiqiy hisobotlar ro‘yxatini ochadi.


Hisobotni qayta yuborish tugmasi /start dagi yozuv tanlash oynasida ham ko‘rinadi. /menu bosh menyuni ochadi; /reports oddiy mijozning o‘z hisoboti bo‘yicha qayta yuborishni, egaga esa haqiqiy PDF hisobotlar ro‘yxatini ochadi. Telegramning umumiy Menu buyruqlariga menu va reports qo‘shilgan; admin buyruqlari faqat egaga tegishli chat scope ichida ko‘rsatiladi.
