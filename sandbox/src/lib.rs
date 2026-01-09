//! landlock-based sandboxing for pullfrog agent execution.
//! applies filesystem and network restrictions that inherit to all child processes.

use landlock::{
    Access, AccessFs, AccessNet, PathBeneath, PathFd, Ruleset, RulesetAttr, RulesetCreatedAttr,
    RulesetStatus, ABI,
};
use napi::bindgen_prelude::*;
use napi_derive::napi;

/// configuration for sandbox restrictions
#[napi(object)]
pub struct SandboxConfig {
    /// when true, filesystem is read-only for the working directory
    /// (allows writes to /tmp, /dev, and other system paths needed for operation)
    pub readonly: bool,
    /// when false, network is disabled (no TCP bind/connect)
    pub network: bool,
}

/// result of landlock support check
#[napi(object)]
pub struct SupportResult {
    pub supported: bool,
    pub reason: Option<String>,
    pub abi_version: Option<u32>,
}

/// check if landlock is supported on the current system.
/// IMPORTANT: this does NOT apply any restrictions - it only checks if the kernel supports landlock.
#[napi]
pub fn is_landlock_supported() -> SupportResult {
    let abi = ABI::V4;

    // check kernel support by trying to create a ruleset (but NOT restricting)
    // we only call create(), not restrict_self(), to avoid applying permanent restrictions
    let test_result = Ruleset::default()
        .handle_access(AccessFs::WriteFile)
        .map_err(|e| e.to_string())
        .and_then(|r| r.create().map_err(|e| e.to_string()));

    match test_result {
        Ok(_ruleset) => {
            // successfully created ruleset - landlock is supported
            // note: we don't call restrict_self() here because that would permanently apply restrictions
            SupportResult {
                supported: true,
                reason: None,
                abi_version: Some(abi as u32),
            }
        }
        Err(e) => SupportResult {
            supported: false,
            reason: Some(format!("landlock not available: {}", e)),
            abi_version: None,
        },
    }
}

/// apply sandbox restrictions to the current process.
/// these restrictions inherit to all child processes and cannot be removed.
///
/// when readonly=true:
/// - blocks writes to the working directory (where the repo is checked out)
/// - allows writes to /tmp, /dev, /var, /run, /home (for agent config/cache files)
/// - this prevents agents from modifying repo files while allowing normal operation
#[napi]
pub fn apply_sandbox(config: SandboxConfig, working_dir: String) -> Result<()> {
    let abi = ABI::V4;

    // handle filesystem restrictions when readonly=true
    if config.readonly {
        // all write-related access flags
        let write_access = AccessFs::WriteFile
            | AccessFs::RemoveFile
            | AccessFs::RemoveDir
            | AccessFs::MakeChar
            | AccessFs::MakeDir
            | AccessFs::MakeReg
            | AccessFs::MakeSock
            | AccessFs::MakeFifo
            | AccessFs::MakeBlock
            | AccessFs::MakeSym
            | AccessFs::Truncate;

        // create ruleset that handles write operations
        let ruleset = Ruleset::default()
            .handle_access(write_access)
            .map_err(|e| {
                Error::new(
                    Status::GenericFailure,
                    format!("failed to handle fs access: {}", e),
                )
            })?
            .create()
            .map_err(|e| {
                Error::new(
                    Status::GenericFailure,
                    format!("failed to create fs ruleset: {}", e),
                )
            })?;

        // paths that need write access for agents to function
        // we allow writes everywhere EXCEPT the working directory
        let allowed_write_paths = [
            "/tmp",  // temp files, agent caches
            "/dev",  // device files (/dev/null, /dev/tty)
            "/var",  // various runtime data
            "/run",  // runtime data
            "/home", // user home directories (agent configs)
            "/root", // root home (when running as root in docker)
        ];

        let mut ruleset = ruleset;
        for path in allowed_write_paths {
            if let Ok(fd) = PathFd::new(path) {
                ruleset = ruleset
                    .add_rule(PathBeneath::new(fd, write_access))
                    .map_err(|e| {
                        Error::new(
                            Status::GenericFailure,
                            format!("failed to add {} rule: {}", path, e),
                        )
                    })?;
            }
            // if path doesn't exist, skip it silently
        }

        // NOTE: we do NOT add the working_dir to allowed paths
        // this means writes to the repo checkout are blocked
        let _ = working_dir; // used for documentation, actual blocking is implicit

        let fs_status = ruleset.restrict_self().map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("failed to apply fs sandbox: {}", e),
            )
        })?;

        if fs_status.ruleset == RulesetStatus::NotEnforced {
            return Err(Error::new(
                Status::GenericFailure,
                "filesystem landlock rules not enforced",
            ));
        }
    }

    // handle network restrictions when network=false
    if !config.network {
        let net_ruleset = Ruleset::default()
            .handle_access(AccessNet::from_all(abi))
            .map_err(|e| {
                Error::new(
                    Status::GenericFailure,
                    format!("failed to handle net access: {}", e),
                )
            })?
            .create()
            .map_err(|e| {
                Error::new(
                    Status::GenericFailure,
                    format!("failed to create net ruleset: {}", e),
                )
            })?;

        let net_status = net_ruleset.restrict_self().map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("failed to apply net sandbox: {}", e),
            )
        })?;

        if net_status.ruleset == RulesetStatus::NotEnforced {
            eprintln!(
                "warning: network landlock rules not enforced (kernel may not support network restrictions)"
            );
        }
    }

    Ok(())
}
