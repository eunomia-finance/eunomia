# Hızlı başlangıç — 5 dakika (testnet)

*English version: [Try it in 5 minutes](/try-it)*

**Eunomia nedir?** Stellar üzerinde, bir yapay zekâ ajanına gerçek harcama yetkisini güvenle
vermeni sağlayan sınırlı bir kasa: günlük limit, ödeme başına limit ve onaylı alıcı listesi
**kontrat** tarafından uygulanır — model ne kadar "ikna edilirse" edilsin, para kuralların
dışına çıkamaz.

Aşağıdaki her şey **testnet**'te çalışır: gerçek para yok, risk sıfır. Sahip olarak yaptığın
her işlemi sen imzalarsın — emanetçi yok, para baştan sona senin kontrolünde.

**Uygulama:** [eunomia.finance](https://eunomia.finance)

## İki giriş yolu

**Passkey ile (en hızlısı).** Face ID, parmak izi ya da cihaz PIN'i. Cüzdan kurmak, kurtarma
kelimesi yazmak ya da önce XLM bulmak yok — passkey bir Stellar akıllı cüzdanını yönetir,
işlem ücretleri karşılanır. Telefonda da aynı şekilde çalışır.

**Cüzdan ile.** Zaten varsa: masaüstünde Freighter, xBull, Albedo, LOBSTR, Rabet ya da Hana;
telefonda WalletConnect destekleyen herhangi bir Stellar cüzdanı. Önce cüzdanın kendi
ayarlarından **Testnet**'e geç. Boş cüzdana tek tıkla **"Get free testnet XLM"** düğmesi
çıkar (ücretler için biraz gerekir).

## Adımlar

1. **Giriş yap** — *Create your treasury with a passkey* → yüzün, parmak izin ya da PIN'inle
   onayla. (Cüzdan mı tercih ediyorsun? *I have a wallet* → kendininkini seç. Telefonda
   **WalletConnect**'i seçip QR'ı okut.)
2. **Kuralları koy ve oluştur — tek imza.** Kasa varsayılan olarak **USDC** tutar (TRY ile
   fonlanır); istersen **XLM**'e çevirirsin (cüzdanından fonlanır). Günlük limiti ve ödeme
   başına limiti gir → *Create treasury* → bir kez onayla. İki isteğe bağlı seçenek aynı
   imzaya katlanır: *+ Approve a payee now* ve *+ Connect an agent now* (7. adım).

   ![Kurulum: kasanın tuttuğu para birimi, iki limit, ilk alıcı, tek düğme](https://raw.githubusercontent.com/eunomia-finance/eunomia/main/docs/screenshots/setup.png)

3. **TRY ile para ekle** — **Overview**'da *Add funds* → bir tutar yaz (50–3000 TRY), karşılığını
   canlı gör → *Get bank details*: banka, IBAN, havale açıklaması ve kurun kilitli kaldığı saat.
   Bu anchor arkasında banka olmayan bir testnet sandbox'ı; o yüzden havale göndermek yerine
   *Declare the transfer sent*'e basarsın; ödediği USDC gerçek testnet USDC'sidir. Birkaç
   saniye sonra para kasadadır, iki işlem de bağlantısıyla görünür. Hiçbir aşamada cüzdan
   onayı çıkmaz. *(XLM kasada: Add funds → tutar → Fund → onayla.)*

   ![TRY ile para ekleme: kilitlenen tutar ve banka bilgileri](https://raw.githubusercontent.com/eunomia-finance/eunomia/main/docs/screenshots/add-funds-try.png)

4. **Bir alıcıyı onayla** — **Payments**'ta ödeme yapılabilecek bir adres ekle. Elinde ikinci
   bir adres yoksa **"use the sample vendor"**a tıkla. *(USDC kasada G… ile başlayan bir
   alıcının USDC alabilmesi için trustline'ı olmalı — örnek satıcıda var; passkey cüzdanına
   bir şey gerekmez.)*
5. **Ödeme gönder** — *Pay by hand* → onayladığın adres, limitler içinde bir tutar → zincire
   düşer ✓ ve kanıtıyla birlikte defterde görünür.
6. **Asıl gösteriyi izle** — ödeme başına limitin **üstünde** bir tutar ya da hiç onaylamadığın
   bir adrese ödeme dene: kontrat bunu **zincir üstünde reddeder**, para yerinden oynamaz.
   O ret, ürünün çalıştığı andır. 🔴

   ![Overview: son karar reddedilmiş, izin verilen ve reddedilen ödemelerin defteri, bütçe sayacı, Leash](https://raw.githubusercontent.com/eunomia-finance/eunomia/main/docs/screenshots/overview.png)

7. **Ajana devret (artık onay penceresi yok)** — **Agent** sayfasında:
   - *En hızlısı:* bir üst sınır ve süre gir → **Start Leash**. Bu cihazdaki bir oturum
     anahtarı artık kendi başına öder — **Run autonomous task**'ı dene: hiç pencere açılmadan
     zincire düşer, bütün kurallar yine geçerlidir.
   - *Kendi ajanın (Claude ya da herhangi bir MCP istemcisi):* sayfanın yazdığı komutu
     kopyala — `npx -y eunomia-mcp init --treasury <kasa kimliğin>` — ajanın çalıştığı
     makinede çalıştır, yazdırdığı açık anahtarı yapıştır, **Authorise agent**. Ajanın gizli
     anahtarı kendi makinesinden hiç çıkmaz. Komut, MCP istemcine ekleyeceğin ayarı da
     yazdırır; ondan sonra ajanın elinde `check_budget`, `pay`, `request_exception` ve
     diğerleri olur — retler ona kontratın kendi hata kodlarıyla döner.

   *Revoke Leash* kontrolü anında geri alır.

   ![Agent: üst sınırı ve geri sayımıyla aktif bir Leash, dış ajan bağlama komutu](https://raw.githubusercontent.com/eunomia-finance/eunomia/main/docs/screenshots/agent-leash.png)

8. **Sahip kontrolleri** — **Settings**'te: *Pause spending* (ajanı dondurur; para çekme yine
   çalışır), *Withdraw* ile parayı geri çek — bir adrese ya da **bankana**: tutarı ve IBAN'ı
   yaz (hazır bir örnek IBAN var), kaç TL edeceğini gör, bir kez imzala — *Update limits* ile
   limitleri canlı değiştir.
   Sahibin her zaman bir çıkışı vardır. Kasan Stellar üzerinde yedeklenir; aynı passkey ya da
   cüzdanla başka bir cihazdan girdiğinde kendiliğinden açılır.

## Bir şey ters giderse

- Hatalar uygulamanın içinde sade bir dille gösterilir (yetersiz bakiye, imza reddedildi vb.).
- TRY transferi yarıda kalırsa (sayfa yenilendi, bağlantı koptu) hiçbir şey kaybolmaz:
  *Add funds*'ı yeniden aç, uygulama bekleyen USDC'yi kasaya taşımayı önerir.
- Sağ alttaki **Share feedback** düğmesi kısa bir form açar — oraya yazacağın iki cümle yol
  haritasını doğrudan şekillendirir. 🙏

## Daha fazlası

- Ana [README](https://github.com/eunomia-finance/eunomia/blob/main/README.md) — mimari, kontratlar, ZK gizli mod
- [Anchor bacağı](/anchor) — TRY'nin harcanabilir bir ajan bütçesine nasıl dönüştüğü, kanıtlarıyla
- [`eunomia-mcp`](/connect-your-agent) — ajanın eline geçen bütün araçlar
- İzleyici demosu (giriş gerekmez): uygulamanın kenar çubuğundaki **Guided demo**
