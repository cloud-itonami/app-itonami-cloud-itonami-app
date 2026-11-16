(ns itonami.workspace-test
  (:require [clojure.test :refer [deftest is testing run-tests]]
            [itonami.workspace.core :as core]))

(deftest owner-and-delegation
  (let [s (core/initial-state "owner-a")
        request {:id "story" :name "Story Bot" :caps #{}}
        created (:state (core/create-bot s {:owner "owner-a" :caps #{}} request))]
    (is (= :owner-required (:error (core/create-bot s {:owner "owner-b" :caps #{}} request))))
    (is (= "owner-a" (get-in created [:bots "story" :owner])))
    (is (= :duplicate-id (:error (core/create-bot created {:owner "owner-a" :caps #{}} request))))
    (is (= :capability-expansion (:error (core/create-bot created {:owner "owner-a" :bot-id "story"}
                                     {:id "bad" :name "Bad" :caps #{:shell}}))))
    (is (= "story" (get-in (:state (core/create-bot created {:owner "owner-a" :bot-id "story"}
                                     {:id "child" :name "Child" :caps #{}})) [:bots "child" :creator])))
    (is (= :creator-not-owned (:error (core/create-bot s {:owner "owner-a" :bot-id "missing"} request))))))

(deftest shared-resource-boundaries
  (let [s (assoc-in (core/initial-state "o") [:models :h3]
                    {:disk :verified :memory :unloaded :leases 0})]
    (is (= :h3 (:model (first core/apps))))
    (is (= :qwen-image (:model (second core/apps)) (:model (nth core/apps 2))))
    (is (= :memory-budget-unavailable-or-insufficient
           (:error (core/model-action s :h3 :load {:available-mib 4000 :peak-mib 8000}))))
    (is (= :load (get-in (core/model-action s :h3 :load {:available-mib 8000 :peak-mib 8000})
                        [:state :models :h3 :pending])))
    (is (= :model-in-use-or-unknown
           (:error (core/model-action (assoc-in (assoc-in s [:models :h3 :memory] :ready)
                                                [:models :h3 :leases] 1) :h3 :release {}))))
    (is (= :verified-artifact-required (:error (core/model-action s :qwen-image :load {}))))
    (is (= :unknown-model (:error (core/model-action s :no-model :download {}))))))

(deftest evidence-is-not-a-click
  (is (= "保存を確認中" (core/storage-label {:remote-receipts-verified? true})))
  (is (= "端末内に保存済み・同期を待機" (core/storage-label {:local-durable? true})))
  (is (= "保持条件成立" (core/storage-label {:local-durable? true :remote-receipts-verified? true
                                      :retention-policy-satisfied? true})))
  (is (= "モデルの準備が必要" (core/model-label {:disk :unverified :memory :ready})))
  (is (= 6 (count core/apps))))

(defn -main []
  (let [r (run-tests 'itonami.workspace-test)]
    #?(:clj (when (pos? (+ (:fail r) (:error r))) (System/exit 1))
       :cljs (when (pos? (+ (:fail r) (:error r))) (set! js/process.exitCode 1)))))
