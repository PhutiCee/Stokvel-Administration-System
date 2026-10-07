CREATE TABLE assistant_query (
 query_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 club_id UUID NOT NULL REFERENCES club(club_id),
 user_id UUID NOT NULL REFERENCES user_account(user_id),
 question_text TEXT NOT NULL CHECK(length(question_text) BETWEEN 1 AND 500),
 classified_intent TEXT NOT NULL,
 outcome TEXT NOT NULL CHECK(outcome IN ('Answered','Declined','Failed')),
 submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX assistant_query_club ON assistant_query(club_id,submitted_at DESC);
CREATE TRIGGER assistant_query_immutable BEFORE UPDATE OR DELETE ON assistant_query FOR EACH ROW EXECUTE FUNCTION completion_immutable();
