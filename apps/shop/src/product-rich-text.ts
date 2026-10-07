/** Layout for already sanitized storefront HTML, including native rich-text images. */
export function responsiveProductHtml(html: unknown): string {
  if (typeof html !== 'string') return '';
  return html.replace(/<img\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi, tag => {
    const attributes = tag.slice(4, -1).replace(/\/?\s*$/, '');
    const kept: string[] = [];
    const attribute = /([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
    for (const match of attributes.matchAll(attribute)) {
      if (match[1] && !['style', 'width', 'height'].includes(match[1].toLowerCase())) kept.push(match[0]);
    }
    return `<img ${kept.join(' ')} style="display:block;width:100%;max-width:100%;height:auto;margin:0 auto;box-sizing:border-box;">`;
  });
}
