/** Simulate plugin activation with a fake Cordis context to verify the WMI helper arm path. */
import { apply } from '../index.js'

const fakeCtx = {
  logger: {
    info: (message) => console.log('INFO ', message),
    warn: (message) => console.log('WARN ', message),
  },
  // Run the effect body now (its returned disposer clears the 45s in-session timer).
  effect: (body) => {
    body()
  },
}

apply(fakeCtx)
setTimeout(() => {
  console.log('simulated activation done')
  process.exit(0)
}, 6000)
