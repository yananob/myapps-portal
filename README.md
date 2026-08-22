# Cloud Run Service Management Portal

Google Cloud プロジェクト内の Cloud Run サービスを一覧表示し、各サービスへのクイックアクセスを提供するポータルサイトです。

## 主な機能

- **Cloud Run サービス一覧の自動取得**: Google Cloud SDK を使用して、指定したプロジェクト・リージョン内のサービスを自動的に取得します。
- **GitHub 連携**: サービス名と一致する GitHub リポジトリへのリンク、および Issue ページへのリンクを自動生成します。
- **Cloud Logging 直リンク**: 各サービスのログ確認画面へのショートカットを提供します。
- **リアルタイムフィルタリング**: サービス名による高速な検索機能。
- **レスポンシブデザイン**: Tailwind CSS を使用した、クリーンで使いやすい UI。

## 技術スタック

- **Frontend/Backend**: Next.js (App Router)
- **UI**: Tailwind CSS, Lucide-react
- **SDK/API**:
  - `@google-cloud/run`
  - `octokit` (GitHub API)

## セットアップ

### 環境変数の設定

実行環境（Cloud Run 等）の環境変数、またはローカル開発時は `.env.local` ファイルに以下の変数を設定してください。

```env
GCP_PROJECT_ID=your-project-id
GCP_REGION=asia-northeast1
GITHUB_PAT=your-github-personal-access-token
GITHUB_OWNER=your-github-org-or-user
```

### 開発サーバーの起動

```bash
npm install
npm run dev
```

### ビルドとデプロイ

```bash
npm run build
# Cloud Run 等へのデプロイ
```

## Cloud Run デプロイ構成と Pub/Sub 起動方法

### 1. HTTP サービスと Event サービスの分離（デプロイ構成）

本プロジェクトでは、用途に応じて **HTTP サービス**（Web UI 用）と **Event サービス**（Pub/Sub・バッチ処理用）の 2 つの Cloud Run サービスを分離してデプロイします。

- **HTTP サービス（例: `myapps-portal`）**
  - **用途**: ユーザーがブラウザでアクセスする Web UI / 画面表示用。
  - **アクセス制御**: `--allow-unauthenticated`（または IAP などによるユーザー認証保護）。
- **Event サービス（例: `myapps-portal-event`）**
  - **用途**: Cloud Pub/Sub や Eventarc などからのイベント通知・バッチ処理実行用（テストサービスの自動クリーンアップや Jules 自動化タスク等）。
  - **アクセス制御**: `--no-allow-unauthenticated`（未認証アクセスの禁止）。Google Cloud 内部の認証済みサービスアカウントによるリクエストのみを許可します。

#### 分離の理由・メリット
1. **セキュリティ向上**: Web 画面への公開エンドポイントと、システム内部の特権処理（サービスの削除や自動化セッションの作成等）を行うイベント受信エンドポイントを分離することで、意図しない外部からの非認可アクセスを防止します。
2. **リソース・ログの独立化**: 画面アクセス トラフィックとバッチ処理の負荷を独立してスケーリングさせ、ログの追跡・監視を容易にします。

---

### 2. Pub/Sub からの起動・トリガー設定

Cloud Run サービスとしてデプロイ後、Pub/Sub トピックからのイベント通知によって処理を自動起動するための設定手順と動作の仕組みです。

#### 動作の仕組み
1. **Middleware による内部ルーティング**:
   Pub/Sub の Push サブスクリプションは、Cloud Run のルートパス (`/`) に `POST` リクエストを送信します。Next.js の Middleware (`src/middleware.ts`) がこれを検出すると、内部的に専用イベントルーティングエンドポイント (`/api/events`) へリライト (Rewrite) します。
2. **バッチ処理のディスパッチ**:
   `/api/events` (および `src/lib/event-router.ts`) はリクエスト内の Pub/Sub データ（`message.data` を Base64 デコードした JSON）やパラメータをパースし、指定された `command` パラメータに応じて以下の処理を実行・ディスパッチします。
   - `command: "cleanup"` (デフォルト): 24時間以上更新のないテスト環境サービス (`-test`, `-test-event`) の削除処理。
   - `command: "jules-automation"`: Jules (AIエンジニア) への自動タスク（テンプレート同期・リファクタリング）作成処理。

#### 設定手順 (GCP Console / gcloud CLI)

1. **Pub/Sub トピックの作成**:
   ```bash
   gcloud pubsub topics create myapps-portal-event
   ```

2. **呼び出し用サービスアカウントの準備と権限付与**:
   Push サブスクリプションが Cloud Run (Event サービス) を安全に呼び出せるよう、`roles/run.invoker` 権限を持つサービスアカウントを作成・設定します。
   ```bash
   # サービスアカウント作成
   gcloud iam service-accounts create pubsub-cloudrun-invoker \
       --display-name="Pub/Sub Cloud Run Invoker"

   # Event サービスへの起動権限を付与
   gcloud run services add-iam-policy-binding myapps-portal-event \
       --member="serviceAccount:pubsub-cloudrun-invoker@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
       --role="roles/run.invoker" \
       --region=asia-northeast1
   ```

3. **Pub/Sub Push サブスクリプションの作成**:
   Push 送信先 URL に Event サービスのルート URL（例: `https://myapps-portal-event-xxx.run.app/`）を指定し、上記のサービスアカウントによる OIDC トークン認証を有効化します。
   ```bash
   gcloud pubsub subscriptions create myapps-portal-event-sub \
       --topic=myapps-portal-event \
       --push-endpoint="https://myapps-portal-event-xxx.run.app/" \
       --push-auth-service-account="pubsub-cloudrun-invoker@YOUR_PROJECT_ID.iam.gserviceaccount.com"
   ```

#### メッセージ Payload の形式

Pub/Sub へパブリッシュするメッセージ本文 (JSON) の例:

- **クリーンアップ処理（Dry-run モード、シミュレーションのみ）**:
  ```json
  {
    "command": "cleanup",
    "dryRun": true
  }
  ```
- **クリーンアップ処理（実際に削除を実行）**:
  ```json
  {
    "command": "cleanup",
    "dryRun": false
  }
  ```
- **Jules 自動化タスク（Dry-run モード）**:
  ```json
  {
    "command": "jules-automation",
    "dryRun": true,
    "task": "all",
    "limit": 3
  }
  ```
- **Jules 自動化タスク（実際のセッションを作成）**:
  ```json
  {
    "command": "jules-automation",
    "dryRun": false,
    "task": "all",
    "limit": 3
  }
  ```

#### 手動トリガー・テスト実行

gcloud CLI またはリポジトリ内のヘルパースクリプトを使用して、Pub/Sub トピックへメッセージを送信できます。

```bash
# gcloud CLI を使用した直接送信例
gcloud pubsub topics publish myapps-portal-event --message='{"command": "cleanup", "dryRun": true}'

# リポジトリ内のスクリプトを使用した送信例
./tests/trigger_event_cloud.sh cleanup true
```

## ライセンス

MIT
