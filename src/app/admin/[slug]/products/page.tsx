import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { bulkImportProducts, deleteProduct, saveProduct } from "../../actions";
import { ATTRIBUTE_EXAMPLES, PRICE_UNITS } from "../../types";

export const dynamic = "force-dynamic";

type Product = Awaited<ReturnType<typeof prisma.product.findMany>>[number];

function ProductForm({
  slug,
  businessType,
  currency,
  product,
}: {
  slug: string;
  businessType: string;
  currency: string;
  product?: Product;
}) {
  const example = ATTRIBUTE_EXAMPLES[businessType] ?? '{"key": "value"}';

  return (
    <form action={saveProduct}>
      <input type="hidden" name="slug" value={slug} />
      {product && <input type="hidden" name="id" value={product.id} />}

      <div className="grid3">
        <label>
          <span>اسم المنتج *</span>
          <input type="text" name="name" required defaultValue={product?.name ?? ""} />
        </label>
        <label>
          <span>الصنف</span>
          <input
            type="text"
            name="category"
            defaultValue={product?.category ?? ""}
            placeholder="خواتم / فساتين / مشاوي"
          />
        </label>
        <label>
          <span>رمز المنتج (SKU)</span>
          <input type="text" name="sku" defaultValue={product?.sku ?? ""} />
        </label>
      </div>

      <label>
        <span>الوصف</span>
        <textarea name="description" defaultValue={product?.description ?? ""} />
      </label>

      <div className="grid3">
        <label>
          <span>السعر ({currency})</span>
          <input
            type="number"
            step="0.001"
            name="price"
            defaultValue={product?.price ? Number(product.price) : ""}
          />
        </label>
        <label>
          <span>وحدة السعر</span>
          <select name="priceUnit" defaultValue={product?.priceUnit ?? "piece"}>
            {PRICE_UNITS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>الكمية بالمخزون</span>
          <input type="number" name="quantity" defaultValue={product?.quantity ?? ""} />
        </label>
      </div>

      <label>
        <span>خصائص إضافية (JSON)</span>
        <textarea
          className="code"
          name="attributes"
          defaultValue={product?.attributes ? JSON.stringify(product.attributes) : ""}
          placeholder={example}
        />
      </label>
      <p className="hint">مثال لنشاطك: {example}</p>

      <label>
        <span>رابط الصورة</span>
        <input type="text" name="imageUrl" defaultValue={product?.imageUrl ?? ""} />
      </label>

      <div className="checkline">
        <input type="checkbox" name="inStock" id={`s-${product?.id ?? "new"}`} defaultChecked={product?.inStock ?? true} />
        <label htmlFor={`s-${product?.id ?? "new"}`} style={{ margin: 0, color: "var(--text)" }}>
          متوفر حالياً
        </label>
      </div>
      <div className="checkline">
        <input type="checkbox" name="active" id={`a-${product?.id ?? "new"}`} defaultChecked={product?.active ?? true} />
        <label htmlFor={`a-${product?.id ?? "new"}`} style={{ margin: 0, color: "var(--text)" }}>
          مفعّل (يظهر للوكيل)
        </label>
      </div>

      <button type="submit">{product ? "حفظ التعديلات" : "إضافة المنتج"}</button>
    </form>
  );
}

export default async function ProductsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, businessType: true, currency: true },
  });
  if (!tenant) notFound();

  const products = await prisma.product.findMany({
    where: { tenantId: tenant.id },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  return (
    <>
      <details className="card">
        <summary>إضافة منتج جديد</summary>
        <div style={{ marginTop: 16 }}>
          <ProductForm
            slug={slug}
            businessType={tenant.businessType}
            currency={tenant.currency}
          />
        </div>
      </details>

      <details className="card">
        <summary>استيراد سريع (قائمة كاملة دفعة واحدة)</summary>
        <div style={{ marginTop: 16 }}>
          <form action={bulkImportProducts}>
            <input type="hidden" name="slug" value={slug} />
            <label>
              <span>سطر لكل عنصر — الاسم | الصنف | السعر | الوصف</span>
              <textarea
                name="bulk"
                rows={9}
                placeholder={
                  "زارا | متاجر | | ملابس رجالية ونسائية، متاح التقسيط\n" +
                  "إتش آند إم | متاجر | | ملابس وأحذية\n" +
                  "نمشي | متاجر | | أزياء وإكسسوارات"
                }
              />
            </label>
            <p className="hint">
              الصنف والسعر والوصف اختيارية — اترك مكانها فارغاً بين الفواصل. مفيد لإدخال
              كتالوج كامل بنسخة واحدة من ملف Excel.
            </p>
            <button type="submit">استيراد</button>
          </form>
        </div>
      </details>

      <h2>الكتالوج ({products.length})</h2>

      {products.length === 0 && (
        <div className="card">
          لا يوجد منتجات. الوكيل لن يستطيع الإجابة عن أي سؤال سعر حتى تضيف منتجاتك.
        </div>
      )}

      {products.map((p) => (
        <details className="card" key={p.id}>
          <summary>
            {p.name}
            {p.price ? ` — ${Number(p.price)} ${p.currency ?? tenant.currency}` : ""}{" "}
            {!p.inStock && <span className="pill warn">غير متوفر</span>}{" "}
            {!p.active && <span className="pill warn">معطّل</span>}
            {p.category && <span className="pill">{p.category}</span>}
          </summary>
          <div style={{ marginTop: 16 }}>
            <ProductForm
              slug={slug}
              businessType={tenant.businessType}
              currency={tenant.currency}
              product={p}
            />
            <form action={deleteProduct} style={{ marginTop: 8 }}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="id" value={p.id} />
              <button type="submit" className="danger">
                حذف المنتج
              </button>
            </form>
          </div>
        </details>
      ))}
    </>
  );
}
