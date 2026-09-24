/** Main-owned copy and responses; Escape is cancellation, never acceptance. */
const api = window.dshUpdateDialog
let view
let responding = false
function respond(index) {
  if (responding || view === undefined) return
  responding = true
  void api.respond(view.revision, index).catch(() => { responding = false })
}
document.getElementById('close').addEventListener('click', () => { respond(view.cancelId) })
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && view !== undefined) { event.preventDefault(); respond(view.cancelId) }
  if (event.key !== 'Tab') return
  const controls = [...document.querySelectorAll('button, details:not([hidden]) > summary, details[open]:not([hidden]) > pre')]
  const current = controls.indexOf(document.activeElement)
  const next = current < 0 ? (event.shiftKey ? controls.length - 1 : 0)
    : (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
  event.preventDefault()
  controls[next].focus()
})
function render(state) {
  if (state === null) {
    responding = true
    document.body.classList.remove('visible')
    return
  }
  if (view !== undefined && state.revision <= view.revision) return
  responding = false
  view = state
  document.documentElement.lang = state.locale
  document.body.dataset.surface = state.surface
  document.title = state.title
  document.getElementById('title').textContent = state.message
  document.getElementById('detail').textContent = state.detail
  document.getElementById('detail').hidden = state.detail === ''
  document.getElementById('close').setAttribute('aria-label', state.closeLabel)
  document.getElementById('technical-details').hidden = state.technicalDetails === ''
  document.getElementById('technical-details-label').textContent = state.technicalDetailsLabel
  document.getElementById('technical-details-content').textContent = state.technicalDetails
  document.getElementById('technical-details').open = false
  document.getElementById('actions').replaceChildren()
  for (const [index, label] of state.buttons.entries()) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.className = index === 0 ? 'primary' : 'secondary'
    button.addEventListener('click', () => { respond(index) })
    document.getElementById('actions').append(button)
  }
  document.querySelector('main').hidden = false
  document.getElementById('dialog').scrollTop = 0
  document.body.classList.add('visible')
  document.getElementById('dialog').focus()
  installCardFit(state)
}
// 卡片窗口不跟内容走，短文案会在下方留出一片裸露的白底；量出布局后的实际
// 高度交给主进程定尺寸。覆盖层本身铺满父窗口，主进程会忽略这个请求。
let fitted = false
function installCardFit(state) {
  if (fitted || state.surface !== 'window') return
  fitted = true
  const report = () => {
    const main = document.getElementById('dialog')
    if (main.hidden) return
    void api.resize(Math.ceil(main.getBoundingClientRect().height)).catch(() => {})
  }
  report()
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(report)
    observer.observe(document.getElementById('dialog'))
    window.addEventListener('pagehide', () => { observer.disconnect() }, { once: true })
  }
  document.getElementById('technical-details').addEventListener('toggle', report)
}
let received = false
const unsubscribe = api.subscribe(state => { received = true; render(state) })
window.addEventListener('pagehide', unsubscribe, { once: true })
void api.status().then(state => { if (!received) render(state) })
