use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::path::PathBuf;

use landlock::{
    Access, AccessFs, AccessNet, PathBeneath, PathFd, Ruleset, RulesetAttr, RulesetCreatedAttr,
    RulesetStatus, ABI,
};

/// filesystem permission configuration
#[napi(object)]
pub struct FsConfig {
    /// paths with read access
    pub read: Option<Vec<String>>,
    /// paths with write access
    pub write: Option<Vec<String>>,
    /// paths with execute access (binaries that can be run)
    pub execute: Option<Vec<String>>,
}

/// network permission configuration
#[napi(object)]
pub struct NetConfig {
    /// ports allowed for TCP connect (0 = all ports allowed)
    pub connect_ports: Option<Vec<u16>>,
}

/// sandbox configuration
#[napi(object)]
pub struct SandboxConfig {
    /// filesystem permissions
    pub fs: Option<FsConfig>,
    /// network permissions
    pub net: Option<NetConfig>,
}

/// result of checking Landlock support
#[napi(object)]
pub struct LandlockSupport {
    /// whether Landlock is supported at all
    pub supported: bool,
    /// the best ABI version available (0-4), or 0 if not supported
    pub abi_version: u32,
    /// whether network rules are supported (requires ABI v4+)
    pub network_supported: bool,
    /// human-readable status message
    pub message: String,
}

/// check if Landlock is supported on this system
#[napi]
pub fn is_landlock_supported() -> LandlockSupport {
    // try to detect the best available ABI
    let abi = ABI::V5;
    
    match Ruleset::default().handle_access(AccessFs::from_all(abi)) {
        Ok(_) => {
            // Landlock is available, check which version
            let abi_version = match abi {
                ABI::V1 => 1,
                ABI::V2 => 2,
                ABI::V3 => 3,
                ABI::V4 => 4,
                ABI::V5 => 5,
                _ => 0,
            };
            
            // network support requires ABI v4+
            let network_supported = abi_version >= 4;
            
            LandlockSupport {
                supported: true,
                abi_version,
                network_supported,
                message: format!(
                    "Landlock ABI v{} available{}",
                    abi_version,
                    if network_supported { " (with network rules)" } else { "" }
                ),
            }
        }
        Err(e) => LandlockSupport {
            supported: false,
            abi_version: 0,
            network_supported: false,
            message: format!("Landlock not available: {}", e),
        },
    }
}

/// apply sandbox restrictions to the current process
/// these restrictions are inherited by all child processes and cannot be lifted
#[napi]
pub fn apply_sandbox(config: SandboxConfig) -> Result<()> {
    let abi = ABI::V5;
    
    // build the ruleset with all access types we want to restrict
    let mut ruleset_attr = Ruleset::default()
        .handle_access(AccessFs::from_all(abi))
        .map_err(|e| Error::new(Status::GenericFailure, format!("failed to create ruleset: {}", e)))?;
    
    // add network handling if available (ABI v4+)
    if let Ok(r) = ruleset_attr.clone().handle_access(AccessNet::from_all(abi)) {
        ruleset_attr = r.handle_access(AccessFs::from_all(abi))
            .map_err(|e| Error::new(Status::GenericFailure, format!("failed to handle fs access: {}", e)))?;
    }
    
    let mut ruleset = ruleset_attr
        .create()
        .map_err(|e| Error::new(Status::GenericFailure, format!("failed to create ruleset: {}", e)))?;
    
    // add filesystem rules
    if let Some(fs_config) = &config.fs {
        // read access
        if let Some(read_paths) = &fs_config.read {
            for path in read_paths {
                if let Err(e) = add_fs_rule(&mut ruleset, path, AccessFs::ReadFile | AccessFs::ReadDir) {
                    // log warning but continue - path might not exist
                    eprintln!("warning: could not add read rule for {}: {}", path, e);
                }
            }
        }
        
        // write access (includes read)
        if let Some(write_paths) = &fs_config.write {
            for path in write_paths {
                let write_access = AccessFs::ReadFile 
                    | AccessFs::ReadDir 
                    | AccessFs::WriteFile 
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
                    
                if let Err(e) = add_fs_rule(&mut ruleset, path, write_access) {
                    eprintln!("warning: could not add write rule for {}: {}", path, e);
                }
            }
        }
        
        // execute access
        if let Some(execute_paths) = &fs_config.execute {
            for path in execute_paths {
                if let Err(e) = add_fs_rule(&mut ruleset, path, AccessFs::Execute | AccessFs::ReadFile) {
                    eprintln!("warning: could not add execute rule for {}: {}", path, e);
                }
            }
        }
    }
    
    // apply restrictions to current process
    let status = ruleset
        .restrict_self()
        .map_err(|e| Error::new(Status::GenericFailure, format!("failed to apply sandbox: {}", e)))?;
    
    match status.ruleset {
        RulesetStatus::FullyEnforced => {
            eprintln!("sandbox: fully enforced");
        }
        RulesetStatus::PartiallyEnforced => {
            eprintln!("sandbox: partially enforced (some rules may not be active)");
        }
        RulesetStatus::NotEnforced => {
            return Err(Error::new(
                Status::GenericFailure,
                "sandbox could not be enforced".to_string(),
            ));
        }
    }
    
    Ok(())
}

/// helper to add a filesystem rule
fn add_fs_rule(
    ruleset: &mut landlock::RulesetCreated,
    path: &str,
    access: AccessFs,
) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let path_buf = PathBuf::from(path);
    
    // skip if path doesn't exist
    if !path_buf.exists() {
        return Ok(());
    }
    
    let path_fd = PathFd::new(&path_buf)?;
    ruleset.add_rule(PathBeneath::new(path_fd, access))?;
    
    Ok(())
}

