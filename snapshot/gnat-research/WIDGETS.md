# Technical-view widget catalog

Definition/body evidence now supplements UI/loaded-client evidence. [E8 provenance](EVIDENCIA_CONFIRMADA.md) is sample-scoped; no universal read authorization exists.

## Definition and permissions

Observed keys: id, title, exposition, icon_class, color, container_children, component_class, component_config, component_has_content_generator, action_has_params, action_provider_id, action_provider_item_name. Containers recurse through container_children and may have null component_class/generator. Actions were empty in the tested definition. Some grid config has dataType; values were not collected.

Loaded initializeTab applies setReadOnly(true) when exposition is read-only and the component supports it. Generator is a **separate loading flag**, not permission. Read-write or row read_only=false is not authority to mutate or proof of server security.

| IDs | Component / role | Observed mode and limit |
| --- | --- | --- |
| 267/2/253/82 | Breadcrumb/display/type/location headers | read-write, generator=true; response strings, never execute HTML |
| 5 | Acs.ExternalIdGrid / IDs | read-only, generator=false; original tab global readOnly=true; scoped body confirmed |
| 45 | Attachments | read-only, generator=false; no new content contract |
| 291 | AM.component.LocationPartsGrid / Parts | Self-loading; scoped two-row body confirmed |
| 133 | DDM.component.LocationDeviceGrid / Devices | DBC-specific metadata; not manually invoked |
| 142 | Electrical.component.NetworkingElectricalInfo | read-write; loader elec_web_object_view.php has scripts:true/autoLoad:false; **not executed** |

Common tabs: 291,101,102,105,5,45,107,138,41,42; line/DC/DF also have 142. Pole has 155/156; DBC has Devices133. Current line, DC and DF views lack 133/155/156. Except IDs5/Attachments45, observed tab exposition is read-write. Metadata does not establish side-effect safety.

## Generated-content sample

Request 4048 asked for [102,105,155,156,138,41,42,267,2,253,82,1,6,7]; return order was [2,253,267,82,41,42,138,156,102,155,105,1,6,7]. Content: strings for 2/253/267/82/1/6; arrays for 41/42/138/156/102/155/105; null for 7. Nonempty row schemas were not collected. The fixture contains only three known entries, not invented rows.

## Native Local rendering -> proposal

Separate definition and self-loading-store adapters. Use individually verified read services with independent authorization; never instantiate GNAT classes, execute component_config/action providers, or load widget142 scripts. Render structured data natively and HTML only through a restricted sanitizing renderer. Preserve per-widget failures without discarding asset identity. The UI read-only gate is evidence, not the Local security boundary.
