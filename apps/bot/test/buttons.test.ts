import { describe, expect, it } from 'vitest';
import { Api } from 'teleproto';

import { buildButtons } from '../src/buttons.js';

describe('buildButtons', () => {
  it('keeps the Mini App separate and places Share and Copy Link together', () => {
    const markup = buildButtons({
      miniAppButton: {
        text: 'Open in Mini App',
        url: 'https://t.me/mybot/view?startapp=abc123',
      },
      shareButton: {
        text: 'Share',
        url: 'https://t.me/share/url?url=https%3A%2F%2Ft.me%2Fmybot%2Fview%3Fstartapp%3Dabc123',
      },
      copyTextButton: {
        text: 'Copy Link',
        copyText: 'https://t.me/mybot/view?startapp=abc123',
      },
    });

    expect(markup).toBeInstanceOf(Api.ReplyInlineMarkup);
    expect(markup?.rows).toHaveLength(2);
    expect(markup?.rows[0]?.buttons).toHaveLength(1);
    expect(markup?.rows[1]?.buttons).toHaveLength(2);

    expect(markup?.rows[0]?.buttons[0]).toMatchObject({
      className: 'KeyboardButtonUrl',
      text: 'Open in Mini App',
      style: { bgPrimary: true },
    });
    expect(markup?.rows[1]?.buttons[0]).toMatchObject({
      className: 'KeyboardButtonUrl',
      text: 'Share',
      style: { bgSuccess: true },
    });
    expect(markup?.rows[1]?.buttons[1]).toMatchObject({
      className: 'KeyboardButtonCopy',
      text: 'Copy Link',
      copyText: 'https://t.me/mybot/view?startapp=abc123',
      style: { bgPrimary: true },
    });
  });
});
