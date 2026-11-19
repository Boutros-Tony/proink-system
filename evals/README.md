# Production check evals

Each case is one real job the foreman should judge the same way every time.

## A case

A folder `evals/cases/<name>/` holds:

- `job.json` — `{ "document": <the stand>, "brief": "<what the user said>", "sourceKind": "description" }`
- `expected.json` — `{ "mustFind": ["a problem that must be reported"], "mustNotFind": ["a problem that must not be reported"] }`
- optionally `file.png`, `file.jpg`, or `file.pdf`, the client's file

`sourceKind` is `description`, `simulation`, `technical`, or `3d_file`.

## Add a case from a real job

In the studio, save the job as a project file. That file is a zip. Unzip it and open `design.json`: that file is the stand, the design document, in millimeters. Copy the whole of `design.json` into `job.json` as the `"document"` value. A stand saved as a plain JSON file, rather than a zip, is already that document.

Write `"brief"` from what the user said the stand is for and what it carries. Write one plain sentence in `mustFind` for each problem the foreman must report, and one in `mustNotFind` for each problem it must not report.

`evals/cases/build-cases.ts` rewrites the two hook-stand cases from `evals/cases/hook-stand.ts`. A new case from a real job is written by hand as `job.json`.

## Run

```
npm run eval
```

The run calls the model for each case, then makes one more call to grade the findings against the sentences. It prints the summary, one line per finding, and pass or fail for each expectation. A case passes when every `mustFind` sentence was reported and no `mustNotFind` sentence was.

The keys live in `.env.local`, or in `.env` when `.env.local` does not set them: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GOOGLE_GENERATIVE_AI_API_KEY`. If the chosen provider has no key, the run skips and says so, instead of failing.

## Model

The default is OpenAI's `gpt-4o`, the default model in `src/lib/ai/models.ts`. Set these to use another one:

- `EVAL_PROVIDER` — `openai`, `anthropic`, or `google`
- `EVAL_MODEL` — the model id, such as `claude-sonnet-4-5` or `gemini-3.8-flash`. Each provider's default is `defaultModel` in `src/lib/ai/models.ts`.
- `EVAL_EFFORT` — `low`, `medium`, or `high`, for a model that takes an effort setting. Left unset, that setting stays medium.

```
EVAL_PROVIDER=google EVAL_MODEL=gemini-3.8-flash npm run eval
```
