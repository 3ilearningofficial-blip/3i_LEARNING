-- Test series courses use exam/subject fields; category should always be "Test Series".
UPDATE courses SET category = 'Test Series'
WHERE course_type = 'test_series' AND COALESCE(category, '') <> 'Test Series';
