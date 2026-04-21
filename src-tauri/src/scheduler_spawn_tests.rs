use crate::db;
use crate::scheduler::{spawn_pipeline_scheduler, PipelineSchedulerRuntime};
use std::panic::AssertUnwindSafe;

#[test]
fn pipeline_scheduler_spawn_does_not_require_tokio_reactor_in_setup_context() {
    let pool = tauri::async_runtime::block_on(db::setup_test_pool());
    let runtime = PipelineSchedulerRuntime::default();

    let result = std::panic::catch_unwind(AssertUnwindSafe(|| {
        spawn_pipeline_scheduler(pool, runtime);
    }));

    assert!(
        result.is_ok(),
        "spawn_pipeline_scheduler should not panic outside a Tokio reactor"
    );
}
