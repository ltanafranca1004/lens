// Builds a sentence-punctuated transcript from streamed speech-recognition results. The Web Speech
// API finalizes on short phrase-pauses, not sentence boundaries, so joining every final with a
// period fragments the text mid-thought — which reads wrong AND breaks evidence highlighting (the
// backend's normalized substring match keeps punctuation, so a fake period cuts a quoted phrase in
// two). Instead, consecutive finals are buffered into one sentence (space-joined) and a sentence
// break is committed only when the caller reports a genuine pause (silence longer than a threshold).
export class TranscriptBuilder {
  private sentences: string[] = []
  private current: string[] = []
  private interim = ''

  // A finalized recognition segment (a phrase). Buffered into the in-progress sentence.
  addFinal(text: string): void {
    const trimmed = text.trim()
    if (trimmed) this.current.push(trimmed)
  }

  // The live, not-yet-final tail shown while speaking.
  setInterim(text: string): void {
    this.interim = text
  }

  // A genuine pause (silence beyond the threshold): commit the in-progress sentence.
  pause(): void {
    if (this.current.length) {
      this.sentences.push(this.current.join(' '))
      this.current = []
    }
  }

  // End of recording: drop any interim tail and commit whatever remains.
  finish(): void {
    this.interim = ''
    this.pause()
  }

  hasPendingSentence(): boolean {
    return this.current.length > 0
  }

  // Completed sentences joined with ". " (+ a trailing period); the in-progress sentence and live
  // interim append without a period (still being spoken). Within a sentence, phrases stay contiguous.
  get text(): string {
    const completed = this.sentences.map((s) => s.trim()).filter(Boolean)
    let out = completed.join('. ')
    if (out) out += '.'
    const active = [this.current.join(' ').trim(), this.interim.trim()].filter(Boolean).join(' ').trim()
    if (active) out += (out ? ' ' : '') + active
    return out
  }
}
