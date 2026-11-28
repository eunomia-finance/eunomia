// What the landing page says, in both languages, and the facts it quotes.
//
// Every number here is one somebody can check: a price read from the service catalog, a
// transaction on Stellar mainnet. Nothing is rounded up and nothing is a projection; what is
// not live yet is listed as not live.
import { EXPLORER } from "../../config";
import { tx } from "../../lib/i18n";
import type { SceneContent, ServiceCard } from "./scene";

const REPO = "https://github.com/eunomia-finance/eunomia";
const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;

/** The version the Agent page prints; kept in step with it. */
export const MCP_VERSION = "0.3.5";

export const CLIENTS = [
  { id: "claude-code", label: "Claude Code" },
  { id: "claude-desktop", label: "Claude Desktop" },
  { id: "cursor", label: "Cursor" },
] as const;
export type ClientId = (typeof CLIENTS)[number]["id"];

/** The command an owner runs to connect an agent. It needs the treasury's address, which
 *  exists only once a treasury is open — so here it is shown with the gap named. */
export const initCommand = (client: ClientId, treasury: string) =>
  `npx -y eunomia-mcp@${MCP_VERSION} init --treasury ${treasury} --client ${client}`;

export interface Rule {
  word: string;
  title: string;
  body: string;
}

export interface ProofRow {
  label: string;
  body: string;
  link: { text: string; href: string };
}

export interface LandingContent {
  nav: { services: string; rules: string; proof: string; docs: string; open: string; openConnected: string };
  rail: string[];
  hero: {
    sentence: string[];
    lede: string;
    live: string;
    cap: string;
    commandNote: string;
    treasuryGap: string;
    copy: string;
    copied: string;
    worksWith: string;
    docs: string;
  };
  services: { eyebrow: string; word: string; cards: ServiceCard[]; perCall: string; source: string; more: string; priceLine: (c: ServiceCard) => string };
  rules: { eyebrow: string; items: Rule[] };
  proof: {
    eyebrow: string;
    headline: string[];
    stamp: string;
    rows: ProofRow[];
    contract: string;
    /** the refused payment as a drawing: what had been paid, where the cap stood, what was asked */
    meter: { paid: string; cap: string; asked: string; sum: string; verdict: string };
  };
  next: { eyebrow: string; title: string; items: string[]; soon: string; note: string };
  call: { title: string; lede: string; docs: string; line: string; by: string; product: string; resources: string; onChain: string };
  links: { repo: string; security: string; roadmap: string; changelog: string; evidence: string };
}

export function landingContent(): LandingContent {
  const cards: ServiceCard[] = [
    { name: tx("Read a web page", "Sayfa okuma"), route: "firecrawl_scrape", price: "0.002" },
    { name: tx("Generate an image", "Görsel üretme"), route: "fal_flux_schnell", price: "0.003" },
    { name: tx("Search the web", "Web araması"), route: "firecrawl_search", price: "0.004" },
    { name: tx("Stellar contract data", "Stellar verisi"), route: "mercury_txs_by_contract", price: "0.001" },
  ];
  return {
    nav: {
      services: tx("Services", "Servisler"),
      rules: tx("Rules", "Kurallar"),
      proof: tx("Proof", "Kanıt"),
      docs: tx("Docs", "Dokümanlar"),
      open: tx("Open the app", "Uygulamayı aç"),
      openConnected: tx("Open your treasury", "Kasanı aç"),
    },
    rail: [tx("Top", "Açılış"), tx("Services", "Servisler"), tx("Rules", "Kurallar"), tx("Proof", "Kanıt"), tx("Next", "Sırada"), tx("Start", "Başla")],
    hero: {
      sentence: [tx("Give your agent a budget,", "Ajanına cüzdanını değil,"), tx("not your wallet.", "bütçe ver.")],
      lede: tx(
        "Set the rules once. Every payment is checked on Stellar; anything outside the rules is refused by itself.",
        "Kuralları bir kez koy. Her ödeme Stellar'da denetlenir; kuralların dışındaki her şey kendiliğinden reddedilir.",
      ),
      live: tx("Live on Stellar mainnet", "Stellar mainnet'te çalışıyor"),
      cap: tx("Beta: at most 100 USDC per treasury", "Beta: kasa başına en çok 100 USDC"),
      commandNote: tx("One command connects your agent. The Agent page prints it with your treasury's address.", "Ajanını tek komut bağlar. Ajan sayfası bu komutu kasanın adresiyle hazır verir."),
      treasuryGap: tx("<your treasury>", "<kasanın adresi>"),
      copy: tx("Copy", "Kopyala"),
      copied: tx("Copied", "Kopyalandı"),
      worksWith: tx("Works with", "Şunlarla çalışır"),
      docs: tx("Docs", "Dokümanlar"),
    },
    services: {
      eyebrow: tx("What your agent can buy today", "Ajanın bugün alabildikleri"),
      word: tx("Services", "Servisler"),
      cards,
      perCall: tx("per call", "çağrı başı"),
      // the four prices were read from the catalog (apiserver.mpprouter.dev) on this date
      source: tx("ROZO MPP Router · Stellar mainnet · read 28 Nov 2026", "ROZO MPP Router · Stellar mainnet · 28 Kas 2026'da okundu"),
      more: tx("Hundreds more in the catalog", "Katalogda yüzlercesi daha var"),
      priceLine: (c) => tx(`${c.price} USDC per call · ${c.route}`, `Çağrı başı ${c.price} USDC · ${c.route}`),
    },
    rules: {
      eyebrow: tx("The rules you set", "Koyduğun kurallar"),
      items: [
        {
          word: tx("DAILY", "GÜNLÜK"),
          title: tx("At most this much a day", "Günde en fazla şu kadar"),
          body: tx("The agent cannot spend more than this in a day. You set the number; the contract holds it.", "Ajan bir günde bundan fazlasını harcayamaz. Sayıyı sen koyarsın, kontrat tutar."),
        },
        {
          word: tx("PER PAYMENT", "ÖDEME BAŞI"),
          title: tx("At most this much at once", "Tek ödemede en fazla şu kadar"),
          body: tx("No single payment goes over this amount, so one mistake cannot be a large one.", "Tek bir ödeme bu tutarı geçemez; bir yanlış büyük bir yanlış olamaz."),
        },
        {
          word: tx("PAYEE", "ALICI"),
          title: tx("Only the places you approved", "Yalnız onayladığın yerlere"),
          body: tx("A payment to an address that is not on your list does not go out — even if the agent was talked into it.", "Listende olmayan adrese ödeme çıkmaz; ajan kandırılmış olsa bile."),
        },
        {
          word: tx("TIME", "SÜRE"),
          title: tx("It ends by itself", "Yetki kendiliğinden biter"),
          body: tx("When the time is up the agent can no longer spend. You can revoke it sooner, with one signature.", "Süre dolunca ajan harcayamaz. İstersen daha önce, tek imzayla iptal edersin."),
        },
      ],
    },
    proof: {
      eyebrow: tx("On Stellar mainnet, with real money", "Stellar mainnet'te, gerçek parayla"),
      headline: [tx("It went outside the rules.", "Kural dışına çıktı."), tx("The chain refused.", "Zincir reddetti.")],
      stamp: tx("REFUSED", "REDDEDİLDİ"),
      rows: [
        {
          label: tx("Refused · 23 Nov 2026", "Reddedilen · 23 Kas 2026"),
          body: tx(
            "The agent asked for 0.2 USDC. The payee was capped at 0.35 a month and 0.3 had been paid. The contract refused: #14 ExceedsPayeeCap.",
            "Ajan 0,2 USDC istedi. Alıcının aylık sınırı 0,35'ti, 0,3'ü ödenmişti. Kontrat reddetti: #14 ExceedsPayeeCap.",
          ),
          link: { text: "4e222114…", href: txUrl("4e2221140ded4165694c0b5d38f71307d89ea85dfd752e0b4743cd058e2b5879") },
        },
        {
          label: tx("Paid · one approval", "Ödenen · tek onay"),
          body: tx(
            "Ten service payments, 0.027 USDC in all. After the one approval the owner was not asked again.",
            "On servis ödemesi, toplam 0,027 USDC. Tek onaydan sonra sahibine bir daha sorulmadı.",
          ),
          link: { text: "2901921f…", href: txUrl("2901921fcde7dcdfb37d918f407cc7d3683458552bb6c50696f734c913719f65") },
        },
        {
          label: tx("Returned", "Geri dönen"),
          body: tx("What the task did not spend, 0.173 USDC, went back to the treasury.", "Görevin harcamadığı 0,173 USDC kasaya geri döndü."),
          link: { text: "58a140de…", href: txUrl("58a140de63a1c3aa284cbaea1bf8adf785b370784cb05af28ab22fcc0516279d") },
        },
        {
          label: tx("Builders · 27 Nov 2026", "Builder'lar · 27 Kas 2026"),
          body: tx(
            "Three builders outside the team opened treasuries with their own wallets, and their agents bought from the catalog.",
            "Ekip dışından üç builder kendi cüzdanıyla kasa açtı; ajanları katalogdan servis satın aldı.",
          ),
          link: { text: tx("the record", "kayıt"), href: `${REPO}/blob/main/docs/EVIDENCE-SOW2.md` },
        },
      ],
      contract: tx("Read the contract", "Kontratı oku"),
      // the numbers of transaction 4e222114… (docs/EVIDENCE-SOW2.md)
      meter: {
        paid: tx("paid 0.30", "ödenmiş 0,30"),
        cap: tx("cap 0.35 / month", "sınır 0,35 / ay"),
        asked: tx("asked +0.20", "istek +0,20"),
        sum: tx("0.30 + 0.20 = 0.50 > 0.35", "0,30 + 0,20 = 0,50 > 0,35"),
        verdict: "#14 ExceedsPayeeCap",
      },
    },
    next: {
      eyebrow: tx("Not live yet", "Henüz canlı değil"),
      title: tx("Next", "Sırada"),
      items: [tx("Gift cards", "Hediye kartı"), tx("Mobile top-up", "Kontör"), "eSIM"],
      soon: tx("soon", "yakında"),
      note: tx("Through Bitrefill. We will say so here when an agent has bought one.", "Bitrefill üzerinden. Bir ajan bunlardan birini satın aldığında burada yazacak."),
    },
    call: {
      title: tx("Give your agent a budget.", "Ajanına bütçe ver."),
      lede: tx("Open a treasury, set the rules, connect your agent with one command.", "Kasanı aç, kuralları koy, ajanını tek komutla bağla."),
      docs: tx("Read the docs", "Dokümanları oku"),
      line: tx("Mainnet beta — real money, capped deposits. Open source, MIT.", "Mainnet beta — gerçek para, sınırlı yatırım. Açık kaynak, MIT."),
      by: tx("Built by Bekir Erdem & Seyit Ali Değirmen · 2nd place, BuildOn Stellar, IBW 2026 — Agentic Track", "Bekir Erdem ve Seyit Ali Değirmen yaptı · BuildOn Stellar, IBW 2026 — Agentic Track ikincisi"),
      product: tx("Product", "Ürün"),
      resources: tx("Resources", "Kaynaklar"),
      onChain: tx("On-chain", "Zincirde"),
    },
    links: {
      repo: REPO,
      security: `${REPO}/blob/main/SECURITY.md`,
      roadmap: `${REPO}/blob/main/ROADMAP.md`,
      changelog: `${REPO}/blob/main/CHANGELOG.md`,
      evidence: `${REPO}/blob/main/docs/EVIDENCE-SOW2.md`,
    },
  };
}

/** What the scene draws, taken from the same content. */
export function sceneContent(c: LandingContent): SceneContent {
  return {
    sentence: c.hero.sentence,
    word: c.services.word,
    rules: c.rules.items.map((r) => r.word),
    cards: c.services.cards,
    perCall: c.services.perCall,
    source: c.services.source,
  };
}
