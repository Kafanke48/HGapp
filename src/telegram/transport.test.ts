import { describe, expect, it } from 'vitest'
import { encodeParams } from './transport.ts'

/**
 * Kodiranje parametrov je edini del transporta, ki ga je smiselno testirati
 * brez omrežja — in prav tu se napaka ne bi videla takoj, ampak šele kot
 * "gumbi v Telegramu se ne prikažejo".
 */
describe('encodeParams', () => {
  it('preproste vrednosti zapiše kot besedilo', () => {
    const body = encodeParams({ chat_id: -100123, text: 'Miha: buy-in 20,00 €' })
    expect(body.get('chat_id')).toBe('-100123')
    expect(body.get('text')).toBe('Miha: buy-in 20,00 €')
  })

  it('sestavljene vrednosti serializira v JSON niz, kot zahteva Telegram', () => {
    const markup = { inline_keyboard: [[{ text: 'Potrdim', callback_data: 'confirm:x' }]] }
    const body = encodeParams({ chat_id: '5', reply_markup: markup })
    expect(body.get('reply_markup')).toBe(JSON.stringify(markup))
  })

  it('polja serializira v JSON niz (npr. allowed_updates)', () => {
    const body = encodeParams({ allowed_updates: ['message', 'callback_query'] })
    expect(body.get('allowed_updates')).toBe('["message","callback_query"]')
  })

  it('undefined in null izpusti, da Telegram ne dobi praznih polj', () => {
    const body = encodeParams({ a: undefined, b: null, c: 0, d: false })
    expect(body.has('a')).toBe(false)
    expect(body.has('b')).toBe(false)
    // 0 in false sta veljavni vrednosti in morata ostati.
    expect(body.get('c')).toBe('0')
    expect(body.get('d')).toBe('false')
  })

  it('šumnike in posebne znake prenese nepokvarjene', () => {
    const body = encodeParams({ text: 'Žetoni se izidejo — č š ž & = ?' })
    expect(body.get('text')).toBe('Žetoni se izidejo — č š ž & = ?')
    // V zakodirani obliki ne sme ostati surov & ali =, ki bi razbil telo.
    expect(body.toString()).not.toContain('ž & =')
  })
})
