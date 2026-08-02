import { prisma } from '../../config/database'

export async function listEmployees(storeId: number, opts: { status?: string; search?: string; page?: number }) {
  const { status, search, page = 1 } = opts
  const limit = 50
  const skip = (page - 1) * limit

  const where = {
    storeId,
    deletedAt: null,
    ...(status ? { status: status as never } : {}),
    ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
  }

  const [employees, total] = await Promise.all([
    prisma.employee.findMany({
      where,
      orderBy: { name: 'asc' },
      skip,
      take: limit,
    }),
    prisma.employee.count({ where }),
  ])

  return { employees, total, page, limit }
}

export async function getEmployee(id: number, storeId: number) {
  return prisma.employee.findFirst({
    where: { id, storeId, deletedAt: null },
    include: { salaryRecords: { orderBy: { salaryDate: 'desc' }, take: 24 } },
  })
}

export async function createEmployee(storeId: number, data: {
  name: string
  contactNumber?: string
  address?: string
  joinedAt?: string
  salary?: number
  salaryFreq?: string
  role?: string
  gender?: string
}, createdBy: number) {
  if (!data.name?.trim()) throw new Error('name is required')

  return prisma.employee.create({
    data: {
      storeId,
      name: data.name,
      contactNumber: data.contactNumber,
      address: data.address,
      joinedAt: data.joinedAt ? new Date(data.joinedAt) : undefined,
      salary: data.salary,
      salaryFreq: (data.salaryFreq as never) ?? 'monthly',
      role: data.role,
      gender: data.gender,
      createdBy,
    },
  })
}

export async function updateEmployee(id: number, storeId: number, data: Partial<{
  name: string
  contactNumber: string
  address: string
  joinedAt: string
  salary: number
  salaryFreq: string
  role: string
  gender: string
}>) {
  const employee = await prisma.employee.findFirst({ where: { id, storeId, deletedAt: null } })
  if (!employee) throw new Error('Employee not found')

  const { joinedAt, salaryFreq, ...rest } = data
  return prisma.employee.update({
    where: { id },
    data: {
      ...rest,
      ...(salaryFreq !== undefined ? { salaryFreq: salaryFreq as never } : {}),
      ...(joinedAt !== undefined ? { joinedAt: new Date(joinedAt) } : {}),
    },
  })
}

export async function setEmployeeStatus(id: number, storeId: number, status: 'active' | 'inactive') {
  const employee = await prisma.employee.findFirst({ where: { id, storeId, deletedAt: null } })
  if (!employee) throw new Error('Employee not found')

  return prisma.employee.update({ where: { id }, data: { status } })
}

export async function recordSalaryPayment(employeeId: number, storeId: number, data: {
  basicSalary: number
  allowances?: number
  deductions?: number
  salaryDate?: string
  remarks?: string
}, createdBy: number) {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, storeId, deletedAt: null } })
  if (!employee) throw new Error('Employee not found')

  const allowances = data.allowances ?? 0
  const deductions = data.deductions ?? 0
  const grossSalary = data.basicSalary + allowances
  const netSalary = grossSalary - deductions
  const salaryDate = data.salaryDate ? new Date(data.salaryDate) : new Date()

  return prisma.$transaction(async (tx) => {
    const record = await tx.salaryRecord.create({
      data: {
        employeeId,
        storeId,
        salaryDate,
        basicSalary: data.basicSalary,
        allowances,
        deductions,
        grossSalary,
        netSalary,
        remarks: data.remarks,
        createdBy,
      },
    })

    await tx.expense.create({
      data: {
        storeId,
        description: `Salary: ${employee.name}`,
        amount: netSalary,
        expenseDate: salaryDate,
        source: 'salary',
        createdBy,
      },
    })

    return record
  })
}
