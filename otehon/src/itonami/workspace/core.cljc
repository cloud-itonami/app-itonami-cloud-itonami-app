(ns itonami.workspace.core
  "Otehon user-side workspace state. No I/O, credentials or consent authority.
  Host adapters authenticate the owner, verify artifacts, execute inference and
  supply Awai FS durability/retention evidence. Requests are never completions."
  (:require [clojure.set :as set] [clojure.string :as str]))

(def apps
  [{:id :dougaka :name "Dougaka" :purpose "動画・音声付き映像" :model :h3}
   {:id :gaka :name "Gaka" :purpose "画像をつくる" :model :qwen-image}
   {:id :mangaka :name "Mangaka" :purpose "コマ・キャラクター・マンガ" :model :qwen-image}
   {:id :ongakuka :name "Ongakuka" :purpose "音楽・音の制作" :model :h3
    :qualification :audio-only-unverified}
   {:id :animeka :name "Animeka" :purpose "アニメーション" :model :h3}
   {:id :dandori :name "Dandori" :purpose "計画・タスク・進行" :model :agent}])

(def models
  {:qwen-image {:name "Qwen Image Turbo Uncensored"
                :pipeline [:text-encoder :denoiser :vae]
                :qualification :unverified}
   :h3 {:name "MiniMax H3" :qualification :unverified
        :local-scope :audio-video-768p :audio-only :unverified}
   :agent {:name "Itonami local inference" :qualification :host-required}})

(defn initial-state [owner]
  {:owner owner :bots {"manimani" {:id "manimani" :owner owner
                                  :name "Manimani" :role :main :caps #{}}}
   :models {} :artifacts {} :view :manimani})

(defn- nonblank? [v] (and (string? v) (not (str/blank? v))))

(defn create-bot
  "A trusted host supplies actor/owner/caps, never an iframe or LLM payload.
  Child creation keeps the owner and can only narrow the creator's capabilities.
  This pure planner does not mint DID, keys, tool approvals or run a Bot."
  [state actor {:keys [id name caps] :as request}]
  (let [creator (get-in state [:bots (:bot-id actor)])
        ceiling (if (:bot-id actor) (:caps creator) (:caps actor))]
    (cond
      (not (and (nonblank? (:owner state)) (= (:owner state) (:owner actor))))
      {:error :owner-required}
      (and (:bot-id actor) (not= (:owner actor) (:owner creator)))
      {:error :creator-not-owned}
      (not (and (nonblank? id) (<= (count id) 128) (nonblank? name)
                (<= (count name) 80) (set? caps) (set? ceiling)))
      {:error :invalid-bot}
      (contains? (:bots state) id) {:error :duplicate-id}
      (not (set/subset? caps ceiling)) {:error :capability-expansion}
      :else
      {:state (assoc-in state [:bots id]
                        {:id id :owner (:owner state) :name (str/trim name)
                         :role :bot :creator (:bot-id actor) :caps caps})})))

(defn model-action
  "Plan one resource operation from host-observed state. The host must resolve
  immutable source/digests and get canonical broker consent before downloading.
  No speculative memory eviction: running leases, loading and unknown budgets
  refuse a load/release. Disk removal is deliberately a different operation."
  [state model action {:keys [available-mib peak-mib]}]
  (let [{:keys [disk memory leases pending]} (get-in state [:models model])]
    (cond
      (not (contains? models model)) {:error :unknown-model}
      pending {:error :operation-pending}
      (not (contains? #{:download :load :release} action)) {:error :unknown-operation}
      (and (= action :download) (= disk :verified)) {:error :already-downloaded}
      (and (= action :load) (not= disk :verified)) {:error :verified-artifact-required}
      (and (= action :load) (not (contains? #{nil :unloaded} memory))) {:error :not-unloaded}
      (and (= action :load)
           (not (and (number? available-mib) (number? peak-mib)
                     (pos? peak-mib) (>= available-mib peak-mib))))
      {:error :memory-budget-unavailable-or-insufficient}
      (and (= action :release) (not= memory :ready)) {:error :not-loaded}
      (and (= action :release) (not= 0 leases)) {:error :model-in-use-or-unknown}
      :else {:request {:model model :action action}
             :state (assoc-in state [:models model :pending] action)})))

(def memory-labels
  {:ready "使用可能" :loading "読込中" :unloaded "未読込" :releasing "解放中"})

(defn model-label [observation]
  (cond
    (:pending observation) "ホストの応答待ち"
    (not= :verified (:disk observation)) "モデルの準備が必要"
    :else (get memory-labels (:memory observation) "メモリ状態を確認中")))

(defn storage-label
  "Display only evidence supplied by the Awai FS adapter, never inferred from
  a successful UI click or a local cache write. Receipt verification and policy
  evaluation remain storage-engine responsibilities."
  [{:keys [local-durable? retention-policy-satisfied? remote-receipts-verified?
           conflict? corrupt?]}]
  (cond corrupt? "破損を検出" conflict? "競合の解決が必要"
        (and local-durable? retention-policy-satisfied? remote-receipts-verified?)
        "保持条件成立"
        local-durable? "端末内に保存済み・同期を待機"
        :else "保存を確認中"))
