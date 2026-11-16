(ns itonami.workspace.browser
  (:require [itonami.workspace.core :as core] [itonami.workspace.view :as view]))

;; Preview is intentionally memory-only, with no credentials or host bridge.
;; Production owner/session must come from the existing authenticated host.
(defonce state (atom (core/initial-state nil)))
(declare render!)

(defn node [value]
  (cond
    (nil? value) (.createTextNode js/document "")
    (vector? value)
    (let [[tag attrs & children] value
          [attrs children] (if (map? attrs) [attrs children] [{} (cons attrs children)])
          el (.createElement js/document (name tag))]
      (doseq [[k v] attrs :when (and (some? v) (not= false v))]
        (.setAttribute el (name k) (if (= true v) "" (str v))))
      (doseq [child children] (.appendChild el (node child))) el)
    :else (.createTextNode js/document (str value))))

(defn render! []
  (let [root (.getElementById js/document "root")]
    (.replaceChildren root (node (view/workspace @state)))))

(defn ^:export init []
  (.addEventListener js/document "click"
    (fn [e]
      (when-let [button (.closest (.-target e) "button[data-action]")]
        (swap! state assoc :view (keyword (.getAttribute button "data-action")) :notice nil)
        (render!)
        (when-let [heading (.querySelector js/document "main h1")]
          (.setAttribute heading "tabindex" "-1") (.focus heading)))))
  (.addEventListener js/document "submit"
    (fn [e]
      (when (= "create-bot" (.-id (.-target e)))
        (.preventDefault e)
        ;; Do not turn a browser form into an authenticated owner grant.
        (swap! state assoc :notice "アカウントの接続が必要です。入力した名前は送信していません。")
        (set! (.-textContent (.getElementById js/document "workspace-status")) (:notice @state)))))
  (render!))
