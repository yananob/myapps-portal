# MyApps Manager (Cloud Run Service & Repository Portal)

Google Cloud プロジェクト内の Cloud Run サービスおよび GitHub リポジトリを一覧表示し、各アプリケーションへのクイックアクセスや Jules (AIエンジニア) 自動リファクタリング、テスト環境の自動削除を提供するポータルサイトです。

## 主な機能

- **リポジトリ・Cloud Run サービス一覧の一括管理**: GitHub API と Google Cloud SDK (@google-cloud/run) を連携し、リポジトリ単位で本番・テスト・イベント用 Cloud Run サービスをグループ化して一覧表示します。
- **Jules (AIエンジニア) 連携 & 自動リファクタリング**: 画面または Pub/Sub イベント経由で Jules セッションを即時起動し、AI によるコード改善と PR 作成を自動化します。
- **Dependabot アラート可視化**: オープンな Dependabot セキュリティアラートの有無と件数をリアルタイム表示します。
- **非表示リポジトリ設定 & スケジュール管理**: Firestore を使用して画面表示から隠したいリポジトリや、Jules 自動化の曜日別起動スケジュール・対象外リポジトリを永続化・変更できます。
- **テスト環境クリーンアップ**: 24時間以上更新のないテスト環境サービス (`-test`, `-test-event`) を自動検知・削除します。
- **PWA / モバイル対応**: PWA (Progressive Web App) 対応でモバイル端末からの操作に最適化されています。

## 技術スタック

- **Frontend/Backend**: Next.js 15 (App Router), React 19, TypeScript
- **UI**: Tailwind CSS, Lucide-react
- **Database**: Google Cloud Firestore (`@google-cloud/firestore`)
- **API/SDK**:
  - `@google-cloud/run`
  - `octokit` (GitHub REST API)
- **Testing**: Vitest (`npm test`)

---

## セットアップ

### 環境変数の設定

実行環境（Cloud Run 等）の環境変数、またはローカル開発時は `.env.local` ファイルに以下の変数を設定してください。

```env
GCP_PROJECT_ID=your-project-id
GCP_REGION=asia-northeast1
GITHUB_PAT=your-github-personal-access-token
GITHUB_OWNER=your-github-org-or-user
JULES_API_KEY=your-jules-api-key
CRON_SECRET=your-cron-secret
APP_ENV=production # または test
```

### 開発サーバーの起動

```bash
npm install
npm run dev
```

### テストの実行

```bash
npm test
# または
./tests/run_tests.sh
```

---

## API エンドポイント仕様

本システムで提供されている REST API エンドポイントの一覧です。

### 1. `GET /api/services`
- **概要**: 全リポジトリと対応する Cloud Run サービス情報を取得・結合して返します。

### 2. `POST /api/events`
- **概要**: Pub/Sub や Cron スケジューラ等からのイベント通知を受信する汎用エンドポイント。
- **認証**: `Authorization: Bearer ${CRON_SECRET}` または同一オリジンからのリクエスト。
- **パラメータ / ペイロード**:
  - `command`: `"cleanup"` (デフォルト) または `"jules-automation"`
  - `dryRun`: `true` (デフォルト) / `false`
  - `limit`: `1` 〜 `3` (Jules 自動化時の対象件数)

### 3. `POST /api/jules-automation`
- **概要**: Jules API を呼び出して自動リファクタリングセッションを作成します。
- **パラメータ**:
  - `dryRun`: シミュレーションの場合 `true`、実際にセッション作成時 `false`
  - `limit`: 実行件数 (`1`〜`3`)
  - `ignoreCooldown`: `true` の場合、10分間の二重起動チェックをバイパス

### 4. `GET / POST /api/jules-config`
- **概要**: Jules 自動化の曜日別起動スケジュール (JST) および対象外リポジトリ設定を取得・保存します。

### 5. `GET / POST /api/hidden-repos`
- **概要**: ダッシュボードで非表示設定されたリポジトリ一覧を取得・更新します。

### 6. `POST /api/cleanup`
- **概要**: 24時間以上非アクティブなテスト環境サービスを削除します（`handleEventRequest` 経由）。

---

## Cloud Run デプロイ構成と Pub/Sub 起動

### 1. HTTP サービスと Event サービスの分離

本プロジェクトでは、用途に応じて 2 つの Cloud Run サービスを分離してデプロイします。

- **HTTP サービス（例: `myapps-portal`）**
  - Web UI 表示用（`--allow-unauthenticated`）
- **Event サービス（例: `myapps-portal-event`）**
  - Pub/Sub・バッチ処理実行用（`--no-allow-unauthenticated`）

### 2. Middleware による内部ルーティング

Pub/Sub の Push サブスクリプションが送信するルートパス (`/`) への `POST` リクエストは、`src/middleware.ts` により内部的に `/api/events` へリライト処理されます。

---

## ライセンス

MIT
