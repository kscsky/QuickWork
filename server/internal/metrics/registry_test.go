package metrics

import "testing"

func TestRegistryExcludesDatabaseSampledMetrics(t *testing.T) {
	registry := NewRegistry(RegistryOptions{})
	families, err := registry.Gatherer.Gather()
	if err != nil {
		t.Fatalf("gather metrics: %v", err)
	}

	retired := map[string]struct{}{
		"quickwork_agent_task_queued":                               {},
		"quickwork_agent_task_running":                              {},
		"quickwork_agent_task_stuck_total":                          {},
		"quickwork_business_sampler_query_errors_total":             {},
		"quickwork_business_sampler_query_seconds":                  {},
		"quickwork_workspace_total":                                 {},
		"quickwork_seat_capacity_outbox_pending":                    {},
		"quickwork_seat_capacity_outbox_dead_lettered":              {},
		"quickwork_seat_capacity_outbox_oldest_pending_age_seconds": {},
		"quickwork_channel_media_pending_objects":                   {},
		"quickwork_channel_media_tombstoned_objects":                {},
		"quickwork_runtime_gc_blocked_observation_failed_total":     {},
		"quickwork_runtime_gc_blocked_runtimes":                     {},
		"quickwork_runtime_gc_backlog_runtimes":                     {},
	}
	for _, family := range families {
		if _, found := retired[family.GetName()]; found {
			t.Errorf("retired database-sampled metric %q is still registered", family.GetName())
		}
	}
}
