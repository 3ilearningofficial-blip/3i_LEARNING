# Tasks

- [x] 1 Backend: Filter standalone tests in GET /api/tests
  - [x] 1.1 Add `AND course_id IS NULL` to the `GET /api/tests` query in `server/routes.ts`
  - [x] 1.2 Verify the optional `type` query param filter still applies alongside the `course_id IS NULL` filter

- [x] 2 Backend: Filter standalone attempts in GET /api/my-attempts
  - [x] 2.1 Update `GET /api/my-attempts` query to JOIN with `tests` and add `WHERE t.course_id IS NULL`

- [x] 3 Backend: Return all attempts in GET /api/tests/:id/my-attempts
  - [x] 3.1 Add (or update) `GET /api/tests/:id/my-attempts` endpoint to return all rows for the authenticated user and test, ordered by `completed_at DESC` (remove any `LIMIT 1`)

- [x] 4 Backend: Return enriched result fields from POST /api/tests/:id/attempt
  - [x] 4.1 Compute `correct`, `incorrect`, `attempted` (correct + incorrect), and `percentage` in the attempt submission handler
  - [x] 4.2 Compute `weakTopics` (distinct topics with at least one wrong answer) only when `test_type = 'mock'`; return empty array otherwise
  - [x] 4.3 Return `correct`, `incorrect`, `attempted`, `testType`, and `weakTopics` in the POST response alongside existing fields

- [x] 5 Frontend: Update Test Screen to support reattempt
  - [x] 5.1 Replace the `GET /api/tests/:id/my-attempt` query with `GET /api/tests/:id/my-attempts` (plural)
  - [x] 5.2 Remove the `useEffect` that auto-redirects to the result screen when a prior attempt exists
  - [x] 5.3 On the pre-start screen, if prior attempts exist, show the last attempt's score summary and a "Reattempt" button
  - [x] 5.4 Update `doSubmit` to pass `correct`, `incorrect`, `attempted`, and `testType` params to the result screen route

- [x] 6 Frontend: Update Test Result Screen
  - [x] 6.1 Remove the Pass/Fail status card and any pass/fail-based header gradient logic
  - [x] 6.2 Add stat cards for Total Score, Total Attempts (questions attempted), Correct, Incorrect, and Percentage
  - [x] 6.3 Show the Weak Topics section only when `testType === 'mock'`
  - [x] 6.4 Fetch attempt history via `GET /api/tests/:id/my-attempts` and render each attempt as a separate row when more than one attempt exists

- [x] 7 Database: Add index for course_id on tests table
  - [x] 7.1 Add migration / startup query: `CREATE INDEX IF NOT EXISTS idx_tests_course_id ON tests(course_id)`
