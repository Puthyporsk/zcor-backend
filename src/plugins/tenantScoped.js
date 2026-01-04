// plugins/tenantScoped.js
// Usage: schema.plugin(tenantScopedPlugin)
// Then: Model.find().byBusiness(req.businessId)

export default function tenantScopedPlugin(schema) {
  schema.query.byBusiness = function byBusiness(businessId) {
    if (!businessId) throw new Error("byBusiness(businessId) is required");
    return this.where({ business: businessId });
  };

  schema.query.notDeleted = function notDeleted() {
    // For collections that have status="deleted"
    return this.where({ status: { $ne: "deleted" } });
  };
}
