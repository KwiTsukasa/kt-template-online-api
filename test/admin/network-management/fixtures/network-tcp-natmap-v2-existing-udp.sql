-- Sanitized offline legacy fixture. It is never applied outside tests.
INSERT INTO network_port_forward (
  id, name, remark, protocol, external_port, internal_port, active_key,
  target_ipv4, desired_presence, keeper_desired_enabled, probe_request_id,
  desired_revision, desired_issued_at, reported_revision, sync_status,
  keeper_status, current_public_ipv4, current_public_port, current_observed_at,
  current_valid_until, last_observed_ipv4, last_observed_port, last_observed_at,
  last_error_code, last_error_message, is_deleted, create_time, update_time
) VALUES (
  2041600000000008213, 'Palworld UDP', 'sanitized existing UDP channel', 'udp',
  8213, 8211, 'udp:8213', '192.168.31.224', 'present', 1, 'probe-8213', 17,
  '2026-07-26 08:00:00.000000', 17, 'synced', 'active', '203.0.113.13', 8213,
  '2026-07-26 08:01:00.000000', '2026-07-26 08:06:00.000000', '203.0.113.13',
  8213, '2026-07-26 08:01:00.000000', NULL, NULL, 0,
  '2026-07-26 07:00:00.000000', '2026-07-26 08:01:00.000000'
);

INSERT INTO network_endpoint_history (
  id, event_id, mapping_id, event_type, public_ipv4, public_port,
  first_observed_at, last_observed_at, occurred_at, reason, create_time
) VALUES (
  2041600000000008214, 'network-8213-published', 2041600000000008213,
  'published', '203.0.113.13', 8213, '2026-07-26 08:01:00.000000',
  '2026-07-26 08:01:00.000000', '2026-07-26 08:01:00.000000', NULL,
  '2026-07-26 08:01:00.000000'
);

INSERT INTO network_ddns_record (
  id, name, remark, record_type, source_type, port_forward_id, domain,
  sub_domain, active_key, enabled, sync_status, is_deleted, create_time,
  update_time
) VALUES (
  2041600000000008215, 'sanitized 8213 DDNS', NULL, 'A', 'port_forward_ipv4',
  2041600000000008213, 'example.test', 'palworld',
  'A:port_forward_ipv4:2041600000000008213:example.test:palworld', 1, 'synced',
  0, '2026-07-26 08:01:00.000000', '2026-07-26 08:01:00.000000'
);
