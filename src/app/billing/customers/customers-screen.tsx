"use client";

/**
 * `/billing/customers` — billing's customer records.
 *
 * Two contract facts shape this page more than anything else.
 *
 * **It is the whole platform's list.** billing declares `security: []` with no
 * `securitySchemes`, and its own header comment says `GET /v1/customers`
 * "returns every customer, because there is no account to scope it by". So this
 * screen is deliberately not a signed-in person's billing page: it says what it
 * is, and it does not borrow the account tenancy identity has to pretend to
 * have. A heading of "Your billing" over an unscoped list would be a lie about
 * a boundary the service does not enforce.
 *
 * **No payment method exists yet.** `processor_customer_id` is "always null in
 * v0: this build makes no Stripe call", so no row says anything about a card.
 * "Not connected" is an answer; a blank cell or a dash invites the reading that
 * something exists and failed to load.
 *
 * There is no plan and no subscription on a `Customer` either, so this screen
 * does not show one. What it can honestly show is the owner reference — which
 * kind of identity record the customer is for — and that is the only link back
 * to the rest of the platform.
 */

import { useRef, useState, type FormEvent } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  FieldSummary,
  Input,
  LoadingState,
  Panel,
  Select,
} from "@/components/ui";
import { useBilling } from "@/lib/billing-context";
import {
  BillingError,
  isCustomer,
  type Customer,
  type CustomerCreate,
  type CustomerOwner,
} from "@/lib/billing";
import { fieldErrorMessage, type FieldError } from "@/lib/identity";

const PAGE_SIZE = 25;

export function CustomersScreen() {
  const billing = useBilling();

  const customers = useInfiniteQuery({
    queryKey: ["billing-customers"],
    queryFn: ({ pageParam }) => billing.listCustomers({ limit: PAGE_SIZE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.page.has_more ? (last.page.next_cursor ?? undefined) : undefined),
    retry: false,
  });

  return (
    <div className="flex flex-col gap-8">
      <CustomerList customers={customers} />
      <CreateCustomerForm />
    </div>
  );
}

function CustomerList({
  customers,
}: {
  customers: ReturnType<typeof useInfiniteQuery<Awaited<ReturnType<ReturnType<typeof useBilling>["listCustomers"]>>>>;
}) {
  if (customers.isPending) return <LoadingState label="Loading customers…" />;

  if (customers.isError) {
    return (
      <ErrorState
        detail="The service did not answer. This is usually temporary."
        onRetry={() => {
          void customers.refetch();
        }}
        title="We could not load the customers."
      />
    );
  }

  const rows = customers.data.pages.flatMap((page) => page.data);

  if (rows.length === 0) {
    return (
      <EmptyState title="No customers">
        No billing record exists for any identity user or account yet.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ul aria-label="Customers" className="flex flex-col gap-2">
        {rows.map((customer, index) =>
          isCustomer(customer) ? (
            <CustomerRow customer={customer} key={customer.id} />
          ) : (
            // Said rather than skipped: a customer that silently fails to render
            // is a customer somebody is looking for.
            <li
              className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted"
              // The id is `unknown` on a value that failed the guard, so it is
              // stringified for the key. `String` never throws, which matters
              // because an object with a null prototype would.
              key={customerKey(customer, index)}
            >
              One customer could not be shown because the service returned data this app
              does not recognise.
            </li>
          ),
        )}
      </ul>

      {customers.hasNextPage ? (
        <div>
          <Button
            aria-busy={customers.isFetchingNextPage}
            busy={customers.isFetchingNextPage}
            disabled={customers.isFetchingNextPage}
            onClick={() => {
              void customers.fetchNextPage();
            }}
            variant="secondary"
          >
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A React key for a customer row, including one that failed the guard.
 *
 * A malformed record's id is `unknown`, and `String` on an arbitrary value can
 * produce the same string for two different rows — which React treats as a
 * duplicate key. The index is mixed in so two unrecognisable records cannot
 * collide, and it is the last resort only: a valid id is used as-is.
 */
function customerKey(customer: unknown, index: number): string {
  const id = (customer as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : `malformed-${index}`;
}

function CustomerRow({ customer }: { customer: Customer }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-raised px-4 py-3">
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">
          {customer.email ?? "No email on file"}
        </span>
        {/* The owner reference is the only link back to identity, and its `type`
            is what makes the uuid meaningful — a bare id is not navigable. The
            type gets its own element rather than sharing one with the id, so it
            is a label a screen reader can land on instead of punctuation. */}
        <span className="truncate text-xs text-muted">
          <span>{customer.owner.type}</span>{" "}
          <span className="font-mono">{customer.owner.id}</span>
        </span>
      </span>
      <span className="flex flex-col items-end gap-1 text-xs text-muted">
        <span className="font-mono">{customer.processor}</span>
        {/* Always null in v0. Stated, so a blank is not read as a failed load. */}
        <span>{customer.processor_customer_id ? customer.processor_customer_id : "Not connected"}</span>
      </span>
    </li>
  );
}

type FormState =
  | { kind: "idle" }
  | { kind: "invalid"; message: string; field: string }
  | { kind: "conflict" }
  | { kind: "failed" };

function CreateCustomerForm() {
  const billing = useBilling();
  const queryClient = useQueryClient();

  const [ownerType, setOwnerType] = useState<CustomerOwner["type"]>("User");
  const [ownerId, setOwnerId] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>({ kind: "idle" });
  const inFlight = useRef(false);

  const create = useMutation({
    mutationFn: (input: CustomerCreate) => billing.createCustomer(input),
    onSuccess: () => {
      // The new record has to appear in the list, and the only way to know its
      // id is the response — so the list is asked again rather than patched.
      void queryClient.invalidateQueries({ queryKey: ["billing-customers"] });
    },
  });

  const errorFor = (field: string) =>
    state.kind === "invalid" && state.field === field ? state.message : undefined;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    const id = ownerId.trim();
    if (id === "") {
      setState({ kind: "invalid", message: "Owner id is required.", field: "owner-id" });
      return;
    }

    inFlight.current = true;
    setState({ kind: "idle" });
    try {
      // Only the fields `CustomerCreate` allows, and `additionalProperties:
      // false` means an unknown one is a 422. No optimistic `metadata: {}`.
      const input: CustomerCreate = {
        owner: { type: ownerType, id },
        processor: "stripe",
      };
      if (email.trim() !== "") input.email = email.trim();

      await create.mutateAsync(input);
      setOwnerId("");
      setEmail("");
      setState({ kind: "idle" });
    } catch (thrown) {
      setState(failureState(thrown));
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <Panel headingId="new-customer" title="New customer">
      <form className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
        {state.kind === "conflict" ? (
          <FieldSummary>A customer already exists for that owner and processor.</FieldSummary>
        ) : null}
        {state.kind === "failed" ? (
          <FieldSummary>We could not create the customer. Try again.</FieldSummary>
        ) : null}

        <Field id="owner-kind" label="Owner kind">
          <Select
            name="owner_type"
            onChange={(event) => setOwnerType(event.target.value as CustomerOwner["type"])}
            value={ownerType}
          >
            {/* The enum is exactly these two. A third would be a contract
                change, and offering it would be offering a link that goes
                nowhere. */}
            <option value="User">User</option>
            <option value="Account">Account</option>
          </Select>
        </Field>

        <Field
          error={errorFor("owner-id")}
          hint="The uuid identity issued. Stored without a foreign key — the two services do not read each other's tables."
          id="owner-id"
          label="Owner id"
        >
          <Input name="owner_id" onChange={(event) => setOwnerId(event.target.value)} value={ownerId} />
        </Field>

        <Field error={errorFor("email")} id="customer-email" label="Email">
          <Input
            autoComplete="off"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            value={email}
          />
        </Field>

        <div>
          <Button aria-busy={create.isPending} busy={create.isPending} disabled={create.isPending} type="submit">
            Create customer
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/** On the field the service named, in the banner when it named none. */
function failureState(thrown: unknown): FormState {
  if (thrown instanceof BillingError) {
    // "One customer per (owner, processor): a second attempt is a 409." Not
    // retryable, so this is a state rather than an error with a Try again.
    if (thrown.status === 409) return { kind: "conflict" };
    const first: FieldError | undefined = thrown.fieldErrors[0];
    if (first) {
      return { kind: "invalid", message: fieldErrorMessage(first.field, first.code), field: first.field };
    }
  }
  return { kind: "failed" };
}
