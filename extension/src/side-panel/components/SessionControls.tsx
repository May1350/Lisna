import { useState } from 'react'
import { useT } from '../../shared/i18n'

interface Props {
  // True while audio/slide capture is running. Used to gate the controls
  // entirely — after session_ended (user-stop OR natural <video> end) the
  // ExportMenu is the only remaining surface and the SessionControls go
  // away. Already enforced by the parent, but kept here as a render-guard.
  isCapturing: boolean
  // Mirrors the underlying <video>'s play/pause state, broadcast from the
  // content script. `null` = we haven't heard from the content script yet.
  videoPlaying: boolean | null
  // Toggle the underlying video's play state. The modal forwards this to
  // the content frame as { source:'sh-parent', type:'SET_PLAY', play:bool };
  // the iframe with the actual <video> calls play()/pause() directly.
  onSetPlay: (play: boolean) => void
  // Permanent session-end. Stops the capture, runs the wrap-up curate,
  // hides this whole control row. Equivalent to the old "停止" button.
  onEnd: () => void
}

// Two-state session controls shown while capture is running:
//
//   - video PLAYING → [ ⏸ 一時停止して整理 ]
//        Pause-as-curate-trigger. Pausing the video debounces a 3 s timer
//        in the content script which fires the curator. The button is
//        the same gesture made discoverable, with copy that explains
//        what pausing actually does.
//
//   - video PAUSED → [ ▶ 再生を続ける ]  [ ✕ セッション終了 ]
//        Resume vs. permanently end. Splitting these two intents was the
//        reason for this component: the previous "停止" button conflated
//        them, leaving users unsure when to press it. End shows a
//        confirmation modal because it's irreversible — once stopped,
//        capture cannot resume in this session.
//
// Hidden entirely when isCapturing is false (capture already wrapped up,
// only ExportMenu remains).
export function SessionControls({ isCapturing, videoPlaying, onSetPlay, onEnd }: Props) {
  const T = useT()
  const [confirmingEnd, setConfirmingEnd] = useState(false)

  if (!isCapturing) return null

  if (confirmingEnd) {
    // Confirm body has an embedded "\n" — split and render with <br/>.
    const bodyLines = T.controls.confirm.body.split('\n')
    return (
      <div className="rounded-lg border border-gray-300 bg-white p-3 text-sm shadow-sm">
        <p className="font-medium text-gray-900 mb-1">
          {T.controls.confirm.title}
        </p>
        <p className="text-xs text-gray-600 leading-relaxed mb-3">
          {bodyLines.map((line, i) => (
            <span key={i}>
              {line}
              {i < bodyLines.length - 1 && <br />}
            </span>
          ))}
        </p>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => setConfirmingEnd(false)}
            className="px-3 py-1.5 text-xs rounded border border-gray-300 hover:bg-gray-50 transition"
          >
            {T.controls.confirm.cancel}
          </button>
          <button
            type="button"
            onClick={() => { setConfirmingEnd(false); onEnd() }}
            className="px-3 py-1.5 text-xs rounded bg-red-600 text-white hover:bg-red-700 transition"
          >
            {T.controls.confirm.confirm}
          </button>
        </div>
      </div>
    )
  }

  // Default to "playing" copy if we haven't heard from the content
  // script yet — first session_started broadcast arrives within ~4 s
  // and applies the real state on top.
  const playing = videoPlaying !== false

  if (playing) {
    // Plain pause-only label. The previous copy ("一時停止して整理 /
    // ここまでの内容で自動的にノートを生成") implied this button generates
    // notes, which confused users — pausing happens to trigger the 3 s
    // debounced curate in the content script, but that's an effect of
    // pausing in general (including via spacebar or the video player's
    // own controls), not something this button does specially. Treat
    // the button as a pure pause control; note generation is its own
    // concern (the "📝 ノートを再生成" button above).
    return (
      <button
        type="button"
        onClick={() => onSetPlay(false)}
        className="w-full rounded-lg bg-gray-100 hover:bg-gray-200 border border-gray-300 text-gray-800 text-xs font-medium px-3 py-2 transition"
      >
        {T.controls.pause}
      </button>
    )
  }

  // Paused → resume + end. End is destructive (irreversible session
  // close), so it's red — matches the previous StopButton color.
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onSetPlay(true)}
        className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-2 transition"
      >
        {T.controls.resume}
      </button>
      <button
        type="button"
        onClick={() => setConfirmingEnd(true)}
        className="rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium px-3 py-2 transition"
        title={T.curate.endButton_title}
      >
        {T.controls.end}
      </button>
    </div>
  )
}
