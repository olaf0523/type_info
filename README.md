# Kaisha Index

[type.jp の掲載企業一覧](https://type.jp/job-company/) から企業情報を収集し、一覧・詳細モーダル付きの Web サイトとして公開するプロジェクトです。GitHub の `main` ブランチへ push すると、Vercel に自動デプロイされます。

## ディレクトリ構成

```
.
├── public/               # Vercel が配信する静的サイト（ビルド不要）
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── companies.csv     # サイトのデータソース（スクレイパーの出力先）
├── scraper/
│   ├── scraper.py        # type.jp のスクレイパー
│   └── requirements.txt
├── vercel.json           # 出力ディレクトリ（public）とレスポンスヘッダー
├── .vercelignore
└── .gitignore
```

## Vercel 自動デプロイの設定（初回のみ）

1. このディレクトリを GitHub リポジトリとして push します。
   ```bash
   git add .
   git commit -m "Initial commit"
   git remote add origin git@github.com:<ユーザー名>/<リポジトリ名>.git
   git push -u origin main
   ```
2. [Vercel](https://vercel.com/new) で **Add New… → Project** を選び、上記リポジトリを Import します。
3. 設定はそのままで **Deploy** を押します。
   - Framework Preset: `Other`
   - Root Directory: `./`
   - Build / Output の設定は `vercel.json` から読み込まれます（ビルドなし、`public/` を配信）。

以降は次のように自動でデプロイされます。

| 操作 | 結果 |
| --- | --- |
| `main` へ push | 本番環境（Production）へデプロイ |
| その他のブランチへ push / Pull Request | プレビュー URL を発行 |

## データの更新

スクレイパーは `public/companies.csv` を直接上書きします。更新後に commit・push すれば、サイトにも反映されます。

```bash
python3 -m venv .venv
.venv/bin/pip install -r scraper/requirements.txt
.venv/bin/python scraper/scraper.py

git add public/companies.csv
git commit -m "Update company data"
git push
```

## ローカルでの確認

CSV を `fetch` で読み込むため、ファイルを直接開くのではなく HTTP サーバー経由で表示してください。

```bash
python3 -m http.server 8000 --directory public
# → http://localhost:8000/
```

## 注意事項

- ロック画面のパスコード判定はブラウザ内（SHA-256 ハッシュ比較）で行っています。閲覧の簡易的な制限であり、`companies.csv` は URL を直接指定すれば取得できます。機密データを置く場合は、Vercel の Deployment Protection などサーバー側の保護を併用してください。
- 企業情報は収集時点のものです。最新情報は各企業の type.jp ページをご確認ください。
