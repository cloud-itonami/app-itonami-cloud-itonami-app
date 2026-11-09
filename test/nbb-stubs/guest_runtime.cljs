(ns guest-runtime
  "Test-only guest for `bin/itonami-mcp`: admits every protocol and reports
  a live main, without the wasm build. Used by
  `test/itonami-mcp-ui.test.mjs` to drive the real host end to end.
  Never required by the host itself. `load-guest` returns a real promise:
  nbb resolves `.catch` only on one, not on a plain thenable object."
  )

(defn load-guest [& _]
  (js/Promise.resolve #js {:hosted #js {} :main 1}))

(defn call-bool [& _] true)
