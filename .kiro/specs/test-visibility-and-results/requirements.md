# Requirements Document

## Introduction

This feature governs two distinct concerns: (1) test visibility — tests created inside a Course or Test Series course must only appear within that course and must not appear in the standalone Test Series section on the home screen; (2) test results — the result page must remove Pass/Fail, display enriched statistics (Total Score, Total Attempts, Correct, Incorrect, Percentage, and Weak Topics for mock tests only), and show each reattempt's result separately.

## Glossary

- **Test_Visibility_Filter**: The backend query logic that restricts which tests are returned by `GET /api/tests` to only standalone tests (course_id IS NULL).
- **Standalone_Test**: A test with `course_id IS NULL` — not linked to any course or test series course.
- **Course_Linked_Test**: A test with a non-null `course_id` — belongs to a specific course or test series course.
- **Test_Series_Section**: The standalone Test Series tab on the home screen that lists tests and results not linked to any course.
- **Attempt_History**: The ordered list of all past attempts a user has made on a single test.
- **Result_Screen**: The screen displayed after a test is submitted, showing the student's performance statistics.
- **Weak_Topics**: A list of topics where the student answered incorrectly, computed at submission time and shown only for mock tests.
- **My_Attempts_Filter**: The backend query logic that restricts `GET /api/my-attempts` to only attempts on standalone tests.

---

## Requirements

### Requirement 1: Standalone Test Visibility

**User Story:** As a student, I want the Test Series section to only show tests that are not linked to any course, so that I don't see course-specific tests mixed into the standalone section.

#### Acceptance Criteria

1. WHEN a client requests `GET /api/tests`, THE Test_Visibility_Filter SHALL return only tests where `course_id IS NULL`.
2. WHEN a client requests `GET /api/tests` with an optional `type` query parameter, THE Test_Visibility_Filter SHALL return only standalone tests matching that type.
3. WHEN a test is created with a non-null `course_id`, THE Test_Series_Section SHALL not display that test.
4. THE Test_Series_Section SHALL display only Standalone_Tests.

---

### Requirement 2: Course-Linked Test Isolation

**User Story:** As a student, I want tests inside a course or test series course to appear only within that course, so that course content stays organized and separate from the standalone section.

#### Acceptance Criteria

1. WHEN a client requests `GET /api/courses/:id`, THE API SHALL return all Course_Linked_Tests where `course_id` equals the requested course id.
2. WHEN a Course_Linked_Test is displayed inside a course, THE Course_Detail_Screen SHALL show it only within that course's Tests tab.
3. THE Test_Series_Section SHALL not display Course_Linked_Tests.

---

### Requirement 3: Standalone Attempt Visibility

**User Story:** As a student, I want the Test Series results section to only show my results for standalone tests, so that results from course-linked tests don't appear in the wrong section.

#### Acceptance Criteria

1. WHEN a client requests `GET /api/my-attempts`, THE My_Attempts_Filter SHALL return only attempts where the associated test has `course_id IS NULL`.
2. THE Test_Series_Section SHALL not display attempt results for Course_Linked_Tests.
3. WHEN a student completes a Course_Linked_Test, THE My_Attempts_Filter SHALL exclude that attempt from `GET /api/my-attempts`.

---

### Requirement 4: Reattempt Support

**User Story:** As a student, I want to reattempt a test I have already completed, so that I can practice and improve my score.

#### Acceptance Criteria

1. WHEN a student opens a test they have previously attempted, THE Test_Screen SHALL display a summary of their last attempt alongside a "Reattempt" button instead of automatically redirecting to the result screen.
2. WHEN a student taps "Reattempt", THE Test_Screen SHALL allow the student to start a new attempt of the same test.
3. WHEN a student submits a reattempt, THE API SHALL insert a new row in `test_attempts` for that student and test.
4. WHEN a client requests `GET /api/tests/:id/my-attempts`, THE API SHALL return all historical attempts for that test ordered by `completed_at DESC`.

---

### Requirement 5: Result Screen — Remove Pass/Fail

**User Story:** As a student, I want the test result page to not show a Pass/Fail label, so that the result focuses on my actual performance metrics.

#### Acceptance Criteria

1. THE Result_Screen SHALL not display a Pass or Fail status label.
2. THE Result_Screen SHALL not apply a pass/fail-based color gradient to the result header.
3. WHEN a test result is displayed, THE Result_Screen SHALL show a neutral header regardless of the student's score.

---

### Requirement 6: Result Screen — Enriched Statistics

**User Story:** As a student, I want the result page to show detailed statistics, so that I can understand my performance clearly.

#### Acceptance Criteria

1. WHEN a test is submitted, THE Result_Screen SHALL display the student's Total Score out of Total Marks.
2. WHEN a test is submitted, THE Result_Screen SHALL display the count of questions the student attempted (Correct + Incorrect, excluding skipped).
3. WHEN a test is submitted, THE Result_Screen SHALL display the count of Correct answers.
4. WHEN a test is submitted, THE Result_Screen SHALL display the count of Incorrect answers.
5. WHEN a test is submitted, THE Result_Screen SHALL display the student's Percentage score.
6. WHEN a test is submitted, THE API SHALL compute and return `correct`, `incorrect`, and `attempted` counts derived from the student's answers and the question answer key.

---

### Requirement 7: Weak Topics (Mock Tests Only)

**User Story:** As a student, I want to see my weak topics after a mock test, so that I know which areas to focus on for improvement.

#### Acceptance Criteria

1. WHEN a mock test is submitted, THE API SHALL compute Weak_Topics as the list of distinct topics where the student answered at least one question incorrectly.
2. WHEN a mock test result is displayed, THE Result_Screen SHALL show the Weak_Topics section.
3. WHEN a non-mock test result is displayed, THE Result_Screen SHALL not show the Weak_Topics section.
4. IF no questions were answered incorrectly in a mock test, THEN THE Result_Screen SHALL display an empty or "No weak topics" state in the Weak_Topics section.

---

### Requirement 8: Per-Attempt Result History

**User Story:** As a student, I want to see each of my past attempts listed separately on the result screen, so that I can track my progress over multiple attempts.

#### Acceptance Criteria

1. WHEN a student has completed more than one attempt on a test, THE Result_Screen SHALL display each attempt's result as a separate entry in an attempt history list.
2. WHEN attempt history is displayed, THE Result_Screen SHALL show the score and date for each attempt.
3. WHEN a student has completed exactly one attempt, THE Result_Screen SHALL not show an attempt history list.

---

### Requirement 9: Score Computation Correctness

**User Story:** As a student, I want my score to be computed accurately, so that I can trust the results shown.

#### Acceptance Criteria

1. FOR ALL submitted answer sets, THE API SHALL ensure that `correct + incorrect + skipped` equals `total_questions`.
2. FOR ALL submitted answer sets, THE API SHALL ensure that `percentage` is between 0 and 100 inclusive.
3. WHEN a student skips a question, THE API SHALL not count that question as correct or incorrect.
