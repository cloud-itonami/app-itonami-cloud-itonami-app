(ns itonami.workspace.view
  "Figma 20:3–20:273 mapped to portable, semantic Hiccup."
  (:require [itonami.workspace.core :as core]))

(defn button [label event] [:button {:type "button" :data-action event} label])

(defn bot-form []
  [:form {:id "create-bot" :aria-labelledby "create-heading"}
   [:h2 {:id "create-heading"} "新しい Bot"]
   [:label {:for "bot-name"} "Bot の名前（必須）"]
   [:input {:id "bot-name" :name "name" :required true :maxlength 80}]
   [:p "役割や細かな設定は、作成後の会話で整えられます。"]
   [:button {:type "submit"} "Bot を作成"]])

(defn content [state]
  (case (:view state)
    :bots [:section [:h1 "あなたの Bots"]
           (into [:div {:class "grid"}]
                 (for [bot (sort-by :id (vals (:bots state)))]
                   [:article [:h2 (:name bot)]
                    [:p (if (= :main (:role bot)) "メイン Bot" "あなたの Bot")]]))
           (bot-form)]
    :apps [:section [:h1 "Apps"] [:p "会話の続きを、それぞれの作業場へ。"]
           (into [:div {:class "grid"}]
                 (for [app core/apps]
                   [:article [:h2 (:name app)] [:p (:purpose app)]
                    [:p (get-in core/models [(:model app) :name])]
                    (button "ひらく" (name (:id app)))]))]
    :models [:section [:h1 "モデルとメモリ"]
             [:p "ダウンロードしたファイルと、メモリへの読込は別に管理します。"]
             (into [:div {:class "grid"}]
                   (for [[id model] (sort-by key core/models)]
                     [:article [:h2 (:name model)]
                      [:p (core/model-label (get-in state [:models id]))]
                      [:p "モデル実行ホストは未接続です。"]]))]
    :files [:section [:h1 "Awai FS"]
            [:p (core/storage-label nil)]
            [:p "保存・同期アダプターの接続を待っています。"]]
    :manimani [:section [:h1 "今日は、何をつくろう。"]
               [:p "Manimani があなたの Bots と Apps をつなぎます。"]
               [:article [:h2 "つくりたいものを、言葉から。"]
                [:p "専任の Bot と一緒にプロジェクトを進められます。"]
                (button "Bot を作成" "bots") (button "Apps をひらく" "apps")]
               [:p "この候補では agent 実行アダプターへの接続はまだありません。"]]
    (if-let [app (some #(when (= (:view state) (:id %)) %) core/apps)]
      [:section [:h1 (:name app)] [:p (:purpose app)]
       [:article [:h2 (get-in core/models [(:model app) :name])]
        [:p (core/model-label (get-in state [:models (:model app)]))]
        [:p "準備と生成を実行するホストの接続を待っています。"]
        (button "モデルを確認" "models")]
       [:h2 "保存先"] [:p "Awai FS / 作品"]
       [:p (core/storage-label nil)]]
      [:section [:h1 "画面が見つかりません"]])))

(defn workspace [state]
  [:div {:class "workspace"}
   [:aside [:h2 "Awai"]
    [:nav {:aria-label "メインメニュー"}
     (button "Manimani" "manimani") (button "Bots" "bots")
     (button "Apps" "apps") (button "ファイル" "files")]
    [:h3 "Apps"]
    (into [:nav {:aria-label "Apps"}]
          (for [app core/apps] (button (:name app) (name (:id app)))))
    (button "モデルとメモリ" "models")]
   [:main (content state)
    [:p {:id "workspace-status" :role "status" :aria-live "polite"} (:notice state)]]])
