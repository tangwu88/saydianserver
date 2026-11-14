import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import sanitizeHtml from "sanitize-html";
import { isUuid, safeObject } from "../common/crypto";
import { PrismaService } from "../common/prisma.service";

export const supportProduct = "say-ring";
const settingKey = "say_ring_online_support";
type Locale = "zh-Hans" | "en";
export function supportLocale(value: unknown): Locale {
  return typeof value === "string" &&
    /^zh(?:[-_;,]|$)/i.test(value.trim()) &&
    !/^zh[-_](hant|tw|hk|mo)(?:[-_;,]|$)/i.test(value.trim())
    ? "zh-Hans"
    : "en";
}

export function whatsappUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const number = /^(?:\+|https:\/\/wa\.me\/)([1-9]\d{6,14})\/?$/.exec(
    value.trim(),
  )?.[1];
  return number ? `https://wa.me/${number}` : null;
}

export function parseSupportConfig(input: unknown) {
  const body = safeObject(input);
  const refs = safeObject(body.faqCategories);
  const guides = Array.isArray(body.guideCategoryIds)
    ? body.guideCategoryIds
    : [];
  const url = whatsappUrl(body.whatsapp);
  if (
    Object.keys(body).some(
      (k) =>
        ![
          "enabled",
          "whatsappEnabled",
          "whatsapp",
          "faqCategories",
          "guideCategoryIds",
        ].includes(k),
    ) ||
    typeof body.enabled !== "boolean" ||
    typeof body.whatsappEnabled !== "boolean" ||
    (body.whatsapp != null && body.whatsapp !== "" && !url) ||
    (body.whatsappEnabled && !url) ||
    Object.keys(refs).some((k) => k !== "zh-Hans" && k !== "en") ||
    Object.values(refs).some(
      (v) => v !== null && (typeof v !== "string" || !isUuid(v)),
    ) ||
    (body.guideCategoryIds !== undefined &&
      !Array.isArray(body.guideCategoryIds)) ||
    guides.length > 8 ||
    guides.some((v) => typeof v !== "string" || !isUuid(v))
  ) {
    throw new BadRequestException(
      "客服配置无效。WhatsApp 请填写含区号的号码或 wa.me 链接。",
    );
  }
  return {
    enabled: body.enabled,
    whatsappEnabled: body.whatsappEnabled,
    whatsapp: url,
    faqCategories: {
      "zh-Hans": (refs["zh-Hans"] as string | null | undefined) ?? null,
      en: (refs.en as string | null | undefined) ?? null,
    },
    guideCategoryIds: [...new Set(guides as string[])],
  };
}

export function supportPlainText(html: string): string {
  return sanitizeHtml(
    html.replace(/<\/(?:p|li|div|h[1-6])\s*>|<br\s*\/?\s*>/gi, "\n"),
    { allowedTags: [], allowedAttributes: {} },
  )
    .replace(
      /&(?:amp|lt|gt|quot|apos|nbsp|#39);/g,
      (m) =>
        ({
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&apos;": "'",
          "&nbsp;": " ",
          "&#39;": "'",
        })[m] ?? m,
    )
    .trim();
}

@Injectable()
export class SupportContent {
  constructor(private readonly prisma: PrismaService) {}

  async config() {
    const row = await this.prisma.appSetting.findFirst({
      where: { key: settingKey, public: true },
      select: { value: true },
    });
    try {
      if (row) return parseSupportConfig(row.value);
    } catch {
      /* Invalid settings fail closed. */
    }
    return parseSupportConfig({ enabled: false, whatsappEnabled: false });
  }

  async publicConfig(locale: unknown) {
    const config = await this.config();
    return {
      product: supportProduct,
      enabled: config.enabled,
      whatsapp:
        config.enabled &&
        supportLocale(locale) === "en" &&
        config.whatsappEnabled
          ? config.whatsapp
          : null,
    };
  }

  async adminConfig() {
    const [config, categories] = await Promise.all([
      this.config(),
      this.prisma.articleCategory.findMany({
        where: { enabled: true, locale: { in: ["zh-Hans", "en"] } },
        select: { id: true, locale: true, name: true },
        orderBy: { name: "asc" },
        take: 500,
      }),
    ]);
    return { config, categories };
  }

  async saveConfig(input: unknown) {
    const config = parseSupportConfig(input);
    const refs = [
      ...new Set([
        ...Object.values(config.faqCategories).filter(
          (value): value is string => value !== null,
        ),
        ...config.guideCategoryIds,
      ]),
    ];
    const categories = await this.prisma.articleCategory.findMany({
      where: { id: { in: refs }, enabled: true },
      select: { id: true, locale: true },
    });
    if (
      categories.length !== refs.length ||
      Object.entries(config.faqCategories).some(
        ([locale, id]) =>
          id && !categories.some((c) => c.id === id && c.locale === locale),
      )
    ) {
      throw new BadRequestException("请选择已启用并且语言匹配的内容分类");
    }
    await this.prisma.appSetting.upsert({
      where: { key: settingKey },
      create: { key: settingKey, public: true, value: config },
      update: { public: true, value: config },
    });
    return config;
  }

  private published(): Prisma.ArticleWhereInput {
    return {
      status: "PUBLISHED",
      publishedAt: { lte: new Date() },
      product: { in: ["say-ring", "shared"] },
      category: { enabled: true },
    };
  }

  async faq(language: unknown, query?: string, offset?: string) {
    const config = await this.config();
    const locale = supportLocale(language);
    const search = typeof query === "string" ? query.trim().slice(0, 80) : "";
    const start = Number(offset || 0);
    if (!Number.isInteger(start) || start < 0 || start > 5_000)
      throw new BadRequestException("无效的文章页码");
    const list = async (lang: Locale) => {
      const categoryId = config.faqCategories[lang];
      if (!categoryId) return [];
      return this.prisma.article.findMany({
        where: {
          ...this.published(),
          categoryId,
          locale: lang,
          ...(search ? { OR: searchable(search) } : {}),
        },
        select: { id: true, title: true, summary: true, locale: true },
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        skip: start,
        take: 21,
      });
    };
    let items = await list(locale);
    // Lock the fallback language in the returned cursor so pagination cannot
    // switch languages just because the preferred list reaches its last page.
    let languageUsed = locale;
    if (start === 0 && locale === "en" && !items.length) {
      languageUsed = "zh-Hans";
      items = await list(languageUsed);
    }
    return {
      items: items.slice(0, 20),
      locale: languageUsed,
      nextOffset: items.length > 20 && start < 5000 ? start + 20 : null,
    };
  }

  async article(id: string) {
    if (!isUuid(id)) throw new NotFoundException("文章不存在");
    const config = await this.config();
    const ids = [
      ...Object.values(config.faqCategories).filter(
        (value): value is string => value !== null,
      ),
      ...config.guideCategoryIds,
    ];
    const article = await this.prisma.article.findFirst({
      where: { ...this.published(), id, categoryId: { in: ids } },
      select: { id: true, title: true, locale: true, contentHtml: true },
    });
    if (!article) throw new NotFoundException("文章不存在");
    return {
      ...article,
      contentHtml: sanitizeHtml(article.contentHtml, {
        allowedTags: [
          "p",
          "br",
          "h2",
          "h3",
          "h4",
          "ul",
          "ol",
          "li",
          "b",
          "strong",
          "em",
          "blockquote",
          "a",
          "img",
        ],
        allowedAttributes: { a: ["href"], img: ["src", "alt"] },
        allowedSchemes: ["https"],
        allowProtocolRelative: false,
        exclusiveFilter: (frame) =>
          frame.tag === "img" &&
          !/^https:\/\/app\.saydian\.cn\//i.test(frame.attribs.src ?? ""),
      }),
    };
  }

  async knowledge(locale: Locale, question: string) {
    const config = await this.config();
    const ids = [
      ...Object.values(config.faqCategories).filter(
        (value): value is string => value !== null,
      ),
      ...config.guideCategoryIds,
    ];
    const terms = supportTerms(question);
    if (!terms.length || !ids.length) return [];
    const candidates = await this.prisma.article.findMany({
      where: {
        ...this.published(),
        categoryId: { in: ids },
        locale: { in: ["zh-Hans", "en"] },
        OR: terms.flatMap(searchable),
      },
      select: {
        id: true,
        title: true,
        summary: true,
        contentHtml: true,
        locale: true,
      },
      orderBy: { publishedAt: "desc" },
      take: 30,
    });
    return candidates
      .map((row) => {
        const body = supportPlainText(row.contentHtml).slice(0, 3500);
        const title = row.title.toLowerCase(),
          summary = (row.summary ?? "").toLowerCase(),
          lowerBody = body.toLowerCase();
        const score = terms.reduce(
          (sum, term) =>
            sum +
            (title.includes(term)
              ? 6
              : summary.includes(term)
                ? 3
                : lowerBody.includes(term)
                  ? 1
                  : 0),
          0,
        );
        return {
          id: row.id,
          title: row.title,
          body,
          score,
          preferred: row.locale === locale,
        };
      })
      .filter((row) => row.score > 0 && row.body.length > 0)
      .sort(
        (a, b) =>
          b.score - a.score || Number(b.preferred) - Number(a.preferred),
      )
      .slice(0, 4)
      .map(({ id, title, body }) => ({ id, title, body }));
  }
}

function searchable(term: string): Prisma.ArticleWhereInput[] {
  return [
    { title: { contains: term, mode: "insensitive" } },
    { summary: { contains: term, mode: "insensitive" } },
    { contentHtml: { contains: term, mode: "insensitive" } },
  ];
}

export function supportTerms(text: string): string[] {
  const terms: string[] = [];
  const stop = new Set([
    "the",
    "how",
    "and",
    "with",
    "for",
    "can",
    "not",
    "please",
    "什么",
    "怎么",
    "如何",
    "一下",
    "不了",
    "我的",
  ]);
  for (const group of text
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9-]{1,30}|\p{Script=Han}+/gu) ?? []) {
    if (/^\p{Script=Han}+$/u.test(group)) {
      const letters = [...group];
      for (let i = 0; i + 1 < letters.length && terms.length < 48; i++)
        terms.push(letters[i]! + letters[i + 1]!);
    } else if (/[a-z]/.test(group)) terms.push(group);
  }
  return [...new Set(terms)].filter((t) => !stop.has(t)).slice(0, 16);
}
