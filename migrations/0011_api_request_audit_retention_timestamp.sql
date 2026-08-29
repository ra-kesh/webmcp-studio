DROP TRIGGER IF EXISTS api_request_audit_retention;

CREATE TRIGGER api_request_audit_retention
AFTER INSERT ON api_request_audit
BEGIN
  DELETE FROM api_request_audit
  WHERE occurred_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days');
END;
