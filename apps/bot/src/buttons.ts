// Telegram inline keyboard construction for bot messages.

import { Api } from 'teleproto';

import type { BotPorts } from './ports.js';

type SendTextOptions = Parameters<BotPorts['sendText']>[2];

export function buildButtons(opts: SendTextOptions): Api.ReplyInlineMarkup | undefined {
  const rows: Api.KeyboardButtonRow[] = [];
  if (opts?.doneButton === true) {
    rows.push(
      new Api.KeyboardButtonRow({
        buttons: [
          new Api.KeyboardButtonCallback({
            style: new Api.KeyboardButtonStyle({ bgPrimary: true }),
            text: '✅ Done — generate link',
            data: Buffer.from('done'),
          }),
        ],
      }),
    );
  }
  if (opts?.miniAppButton !== undefined) {
    rows.push(
      new Api.KeyboardButtonRow({
        buttons: [
          new Api.KeyboardButtonUrl({
            style: new Api.KeyboardButtonStyle({ bgPrimary: true }),
            text: opts.miniAppButton.text,
            url: opts.miniAppButton.url,
          }),
        ],
      }),
    );
  }
  const shareButtons: Api.TypeKeyboardButton[] = [];
  if (opts?.shareButton !== undefined) {
    shareButtons.push(
      new Api.KeyboardButtonUrl({
        style: new Api.KeyboardButtonStyle({ bgSuccess: true }),
        text: opts.shareButton.text,
        url: opts.shareButton.url,
      }),
    );
  }
  if (opts?.copyTextButton !== undefined) {
    shareButtons.push(
      new Api.KeyboardButtonCopy({
        style: new Api.KeyboardButtonStyle({ bgPrimary: true }),
        text: opts.copyTextButton.text,
        copyText: opts.copyTextButton.copyText,
      }),
    );
  }
  if (shareButtons.length > 0) {
    rows.push(
      new Api.KeyboardButtonRow({
        buttons: shareButtons,
      }),
    );
  }
  if (rows.length === 0) return undefined;
  return new Api.ReplyInlineMarkup({
    rows,
  });
}
